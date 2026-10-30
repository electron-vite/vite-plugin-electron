import { createServer } from 'vite'

import { createElectronPlugin } from '../../../src/base'
import { triggerStartup } from '../../../src/startup'

const mode = process.env.SHUTDOWN_REPRO_MODE ?? 'descendants'
const childPath = process.env.SHUTDOWN_CHILD
const electronRoot = process.env.SHUTDOWN_ELECTRON_ROOT
const delayMs = Number(process.env.SHUTDOWN_WATCHER_DELAY_MS ?? 0)

// Windows has no catchable SIGINT for child.kill(): it is TerminateProcess. The repro
// drives Ctrl+C over IPC instead so the plugin's real SIGINT handler still runs.
// SHUTDOWN_SIGINT_VIA_IPC=1 forces this path on Unix for verification.
const sigintViaIpc = process.platform === 'win32' || process.env.SHUTDOWN_SIGINT_VIA_IPC === '1'
// Host leaves via process.exit() while Electron is alive (not Ctrl+C / server.close()).
process.on('message', (message: { type?: string; code?: number } | null) => {
  if (message?.type === 'host-exit') {
    process.exit(message.code ?? 0)
  }
})

if (sigintViaIpc) {
  process.on('message', (message: { type?: string } | null) => {
    if (message?.type === 'sigint') {
      process.emit('SIGINT', 'SIGINT')
    }
  })
}

if (!childPath || !electronRoot) {
  throw new Error('SHUTDOWN_CHILD and SHUTDOWN_ELECTRON_ROOT are required')
}

function createPlugins(label: string, childMode: string) {
  return createElectronPlugin({
    prefix: `shutdown-repro-${label}`,
    async dev(context, server, _isESM, session) {
      triggerStartup(
        context,
        server,
        {
          async onstart({ startup }) {
            const started = await startup(
              [childPath, childMode],
              {
                cwd: electronRoot,
                stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
              },
              'node-electron-fixture',
            )
            const child = process.electronApp
            child?.stdout?.on('data', (chunk) => process.stdout.write(chunk))
            child?.stderr?.on('data', (chunk) => process.stderr.write(chunk))
            child?.on('message', (message) => process.send?.(message))
            child?.send('start')
            if (!started) {
              process.send?.({ error: 'startup-prevented', label })
            }
          },
        },
        session,
      )
      if (!delayMs) {
        return
      }
      return () =>
        new Promise<void>((resolve) => {
          console.log(`[shutdown-host] delaying ${label} cleanup ${delayMs}ms`)
          setTimeout(resolve, delayMs)
        })
    },
    build() {},
  })
}

const plugins =
  mode === 'two-plugins'
    ? [...createPlugins('a', 'ignore-signals'), ...createPlugins('b', 'stay')]
    : createPlugins(
        'a',
        mode === 'natural-exit'
          ? 'natural-exit'
          : mode === 'ignore-signals'
            ? 'ignore-signals'
            : 'descendants',
      )

const server = await createServer({
  configFile: false,
  root: electronRoot,
  plugins,
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0 },
})

if (mode === 'natural-exit') {
  // Stand in for Vite CLI leftovers (stdin / shortcuts) after server.close().
  setInterval(() => {}, 1000)
}

await server.listen()
process.send?.({ listening: true })
