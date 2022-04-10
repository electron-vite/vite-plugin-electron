import type { Configuration } from './types'
import type { Plugin } from 'vite'
import { bootstrap } from './serve'
import { build } from './build'

export { Configuration }

export function defineConfig(config: Configuration) {
  return config
}

export default function electron(config: Configuration): Plugin[] {
  const name = 'vite-plugin-electron'

  return [
    {
      name: `${name}:serve`,
      apply: 'serve',
      configureServer(server) {
        server.httpServer.on('listening', () => {
          bootstrap(config, server)
        })
      },
    },
    {
      name: `${name}:build`,
      apply: 'build',
      async configResolved(viteConfig) {
        await build(config, viteConfig)
      },
    },
  ]
}
