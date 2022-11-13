import type { Plugin } from 'vite'
import { bootstrap } from './serve'
import { build } from './build'

// public
export { defineConfig, resolveViteConfig, withExternalBuiltins } from './config'
export { build }

export interface Configuration {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry?: import('vite').LibraryOptions['entry']
  vite?: import('vite').InlineConfig
  /**
   * Triggered when Vite is built every time -- `vite serve` command only.
   * 
   * If this `onstart` is passed, Electron App will not start automatically.  
   * However, you can start Electroo App via `startup` function.  
   */
  onstart?: (this: import('rollup').PluginContext, options: {
    /**
     * Electron App startup function.  
     * It will mount the Electron App child-process to `process.electronApp`.  
     * @param argv default value `['.', '--no-sandbox']`
     */
    startup: (argv?: string[]) => Promise<void>
    /** Reload Electron-Renderer */
    reload: () => void
  }) => void
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

  return [
    {
      name: `${name}:serve`,
      apply: 'serve',
      ...configBuild,
      configureServer(server) {
        server.httpServer?.on('listening', () => {
          bootstrap(config, server)
        })
      },
    },
    {
      name: `${name}:build`,
      apply: 'build',
      ...configBuild,
      async closeBundle() {
        await build(config)
      }
    },
  ]
}

/**
 * Electron App startup function.  
 * It will mount the Electron App child-process to `process.electronApp`.  
 * @param argv default value `['.', '--no-sandbox']`
 */
export async function startup(argv = ['.', '--no-sandbox']) {
  const { spawn } = await import('child_process')
  // @ts-ignore
  const electron = await import('electron')
  const electronPath = electron.default ?? electron

  if (process.electronApp) {
    process.electronApp.removeAllListeners()
    process.electronApp.kill()
  }

  // Start Electron.app
  process.electronApp = spawn(electronPath, argv, { stdio: 'inherit' })
  // Exit command after Electron.app exits
  process.electronApp.once('exit', process.exit)
}
