import type { Configuration } from './types'
import type { Plugin, ResolvedConfig } from 'vite'
import { bootstrap, onstart } from './serve'
import { build } from './build'
import renderer from 'vite-plugin-electron-renderer'
import buildConfig from 'vite-plugin-electron-renderer/plugins/build-config'

// public export
export {
  type Configuration,
  onstart,
}
export function defineConfig(config: Configuration) {
  return config
}

export default function electron(config: Configuration): Plugin[] {
  const name = 'vite-plugin-electron'

  return [
    ...(config.renderer
      // Enable use Electron, Node.js API in Renderer-process
      ? renderer(config.renderer)
      // There is also `buildConfig()` in `renderer()`
      : [buildConfig()]
    ),
    {
      name: `${name}:serve`,
      apply: 'serve',
      configureServer(server) {
        server.httpServer.on('listening', () => {
          bootstrap(config, server)
        })
      },
    },
    ((): Plugin => {
      let viteConfig: ResolvedConfig

      return {
        name: `${name}:build`,
        apply: 'build',
        configResolved(config) {
          viteConfig = config
        },
        async closeBundle() {
          await build(config, viteConfig)
        }
      }
    })()
  ]
}
