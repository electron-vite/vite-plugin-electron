import type { Plugin, ResolvedConfig } from 'vite'
import { bootstrap, startup } from './serve'
import { build } from './build'

export { startup }

export function defineConfig(config: Configuration) {
  return config
}

export interface Configuration {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry?: import('vite').LibraryOptions['entry']
  vite?: import('vite').InlineConfig
  /**
   * Triggered when Vite is built every time.
   * 
   * If this `onstart` is passed, Electron App will not start automatically.  
   * However, you can start Electroo App via `startup` function.  
   */
  onstart?: (this: import('rollup').PluginContext, options: {
    /**
     * Electron App startup function
     * @param argv default value `['.', '--no-sandbox']`
     */
    startup: (argv?: string[]) => Promise<void>
    /** Reload Electron-Renderer */
    reload: () => void
  },
  ) => void
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
