import type { Plugin, ResolvedConfig } from 'vite'
import { bootstrap, startup } from './serve'
import { build } from './build'

export { startup }

export function defineConfig(config: Configuration) {
  return config
}

export type Configuration = {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry?: import('vite').LibraryOptions['entry']
  /**
   * Triggered when Vite is built.  
   * If passed this parameter will not automatically start Electron App.  
   * You can start Electron App through the `startup` function passed through the callback function.  
   */
  onstart?: (this: import('rollup').PluginContext, startup: (args?: string[]) => Promise<void>) => void
  vite?: import('vite').InlineConfig
}

export default function electron(config: Configuration | Configuration[]): Plugin[] {
  const name = 'vite-plugin-electron'
  const configBuild: Partial<Plugin> = {
    config(config) {
      // make sure that Electron can be loaded into the local file using `loadFile` after packaging
      config.base ??= './'

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
