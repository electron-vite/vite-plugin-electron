import { createServer } from 'vite'

import { createElectronPlugin } from '../../src/base'
import { triggerStartup } from '../../src/startup'

const [mode, root, childFixture] = process.argv.slice(2)
let generation = 0
const plugins = createElectronPlugin({
  prefix: 'shutdown-test',
  dev(context, server, _isESM, session) {
    if (++generation > 1) return
    triggerStartup(context, server, {
      async onstart({ startup }) {
        await startup(
          [childFixture!],
          { stdio: ['ignore', 'ignore', 'ignore', 'ipc', 'pipe'] },
          'node-electron-fixture',
        )
        const child = process.electronApp!
        child.on('message', (message: any) => {
          if (mode === 'restart') {
            if (message === 'ready') void server.restart()
            if (message === 'stopping') process.send?.({ ready: true, childPid: child.pid })
          } else if (message.descendantPid) {
            process.send?.({ ready: true, childPid: child.pid, descendantPid: message.descendantPid })
            child.send('exit')
          }
        })
        if (mode !== 'restart') child.send('start')
      },
    }, session)
    return () => {
      if (mode !== 'restart') process.send?.({ cleaned: true })
    }
  },
  build() {},
})
const middlewareMode = mode === 'middleware'
if (middlewareMode) setInterval(() => {}, 1000)
const host = middlewareMode ? (await import('node:http')).createServer() : undefined
const server = await createServer({
  configFile: false,
  root,
  plugins: [
    ...(host ? [{
      name: 'middleware-host',
      configureServer(server: any) {
        server.httpServer = host
      },
    }] : []),
    ...plugins,
  ],
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0, middlewareMode },
})
if (middlewareMode) {
  // A middleware host decides when to start the plugin's dev work.
  host!.emit('listening')
} else {
  await server.listen()
}
