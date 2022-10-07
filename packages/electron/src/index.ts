import type { Configuration } from './types'
import type { Plugin, ResolvedConfig } from 'vite'
import {
  bootstrap,
  onstart,
  startup,
} from './serve'
import { build } from './build'

// public export
export {
  type Configuration,
  onstart,
  startup,
}
export function defineConfig(config: Configuration) {
  return config
}

export default function electron(config: Configuration | Configuration[]): Plugin[] {
  const name = 'vite-plugin-electron'
  const configBuild: Partial<Plugin> = {
    config(config) {
      config.build ??= {}
      // prevent accidental clearing of `dist/electron/main`, `dist/electron/preload`
      config.build.emptyOutDir ??= false
    },
  }
  const configArray = ([].concat(config as any) as Configuration[])

  return [
    {
      name: `${name}:serve`,
      apply: 'serve',
      ...configBuild,
      configureServer(server) {
        server.httpServer!.on('listening', () => {
          bootstrap(configArray, server)
        })
      },
    },
    ((): Plugin => {
      let viteConfig: ResolvedConfig

      return {
        name: `${name}:build`,
        apply: 'build',
        ...configBuild,
        configResolved(config) {
          viteConfig = config
        },
        async closeBundle() {
          for (const _config of configArray) {
            await build(_config, viteConfig)
          }
        }
      }
    })(),
  ]
}
