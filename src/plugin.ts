import type { Plugin } from 'vite'
import electronRenderer from 'vite-plugin-electron-renderer'
import { Configuration } from './types'
import { bootstrap } from './serve'
import { build } from './build'

export const NAME = 'vite-plugin-electron'

export function electron(config: Configuration): Plugin[] {

  return [
    {
      name: `${NAME}:serve`,
      apply: 'serve',
      configureServer(server) {
        const printUrls = server.printUrls
        server.printUrls = function () {
          printUrls()
          bootstrap(config, server)
        }
      },
    },
    {
      name: `${NAME}:build`,
      apply: 'build',
      async configResolved(viteConfig) {
        await build(config, viteConfig)
      },
    },
    ...(config.main.nodeIntegration ? electronRenderer() : []),
  ]
}
