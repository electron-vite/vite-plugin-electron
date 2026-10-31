import { createServer } from 'vite'

import { createElectronPlugin } from '../../src/base'
import { triggerStartup } from '../../src/startup'

const [mode, root, childFixture, marker] = process.argv.slice(2)

const plugins = createElectronPlugin({
  prefix: 'dev-shutdown-test',
  dev(context, server, _isESM, session) {
    triggerStartup(
      context,
      server,
      {
        async onstart({ startup }) {
          await startup(
            [childFixture!, mode!, marker!],
            { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
            'node-electron-fixture',
          )
          const child = process.electronApp!
          child.once('message', () => process.send?.({ ready: true, childPid: child.pid }))
        },
      },
      session,
    )
  },
  build() {},
})

process.on('message', (message) => {
  if (message === 'sigint') {
    // Windows cannot deliver a real SIGINT to another process, so the test asks us to emit it.
    process.emit('SIGINT')
  } else if (message === 'host-exit') {
    // Exit without going through any plugin shutdown path.
    process.exit(0)
  }
})

const server = await createServer({
  configFile: false,
  root,
  plugins,
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0 },
})
await server.listen()
