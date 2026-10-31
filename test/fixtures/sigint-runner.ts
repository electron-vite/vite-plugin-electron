import { createServer } from 'vite'

import { createElectronPlugin } from '../../src/base'
import { triggerStartup } from '../../src/startup'

const [mode, root, childFixture, marker] = process.argv.slice(2)

const plugins = createElectronPlugin({
  prefix: 'sigint-test',
  dev(context, server) {
    triggerStartup(context, server, {
      async onstart({ startup }) {
        await startup(
          [childFixture!, mode!, marker!],
          { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
          'node-electron-fixture',
        )
        const child = process.electronApp!
        child.once('message', () => process.send?.({ ready: true, childPid: child.pid }))
      },
    })
  },
  build() {},
})

// Windows cannot deliver a real SIGINT to another process, so the test asks us to emit it.
process.on('message', (message) => {
  if (message === 'sigint') {
    process.emit('SIGINT')
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
