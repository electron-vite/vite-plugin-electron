import fs from 'node:fs'
import path from 'node:path'
import {
  type Plugin,
  type UserConfig,
  mergeConfig,
} from 'vite'
import type { InputOption } from 'rollup'
import electron, { type ElectronOptions } from '.'

export interface ElectronSimpleOptions {
  main: ElectronOptions
  preload?: Omit<ElectronOptions, 'entry'> & {
    /**
     * Shortcut of `build.rollupOptions.input`.
     * 
     * Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
     */
    input: InputOption
  }
  /**
   * Support use Node.js API in Electron-Renderer
   * @see https://github.com/electron-vite/vite-plugin-electron-renderer
   */
  renderer?: import('vite-plugin-electron-renderer').RendererOptions
}

// The simple API just like v0.9.x
// Vite v3.x support async plugin.
export default async function electronSimple(options: ElectronSimpleOptions): Promise<Plugin[]> {
  const flatApiOptions = [options.main]
  const packageJson = resolvePackageJson() ?? {}
  const esmodule = packageJson.type === 'module'
  if (options.preload) {
    const {
      input,
      vite: viteConfig = {},
      ...preloadOptions
    } = options.preload
    const preload: ElectronOptions = {
      onstart(args) {
        // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete, 
        // instead of restarting the entire Electron App.
        args.reload()
      },
      ...preloadOptions,
      vite: mergeConfig({
        build: {
          rollupOptions: {
            // `rollupOptions.input` has higher priority than `build.lib`.
            // https://github.com/vitejs/vite/blob/v5.0.9/packages/vite/src/node/build.ts#L482
            input,
            // For use the Electron API - `import { contextBridge, ipcRenderer } from 'electron'`,
            output: {
              // In most cases, use `cjs` format.
              // @see - https://github.com/electron/electron/blob/v30.0.0-nightly.20240104/docs/tutorial/esm.md#preload-scripts
              // @see - https://github.com/electron-vite/vite-plugin-electron-preload/blob/v0.2.0/src/index.ts#L24-L47
              format: 'cjs',

              // Whether Node.js is enabled in the Main process or not, the Preload scripts supports loading `electron` module, 
              // so we need to build it in `cjs` format.

              // e.g.
              // import { ipcRenderer } from 'electron'
              // // ↓↓↓↓ Build with `cjs` format ↓↓↓↓
              // const { ipcRenderer } = require('electron')

              // Note, however, that `preload.ts` should not be split. 🚧
              // When Rollup builds code in `cjs` format, it will automatically split the code into multiple chunks, and use `require()` to load them, 
              // and use `require()` to load other modules when `nodeIntegration: false` in the Main process Errors will occur.
              // So we need to configure Rollup not to split the code when building to ensure that it works correctly with `nodeIntegration: false`.
              inlineDynamicImports: true,

              // @see - https://github.com/vitejs/vite/blob/v5.0.9/packages/vite/src/node/build.ts#L608
              entryFileNames: `[name].${esmodule ? 'mjs' : 'js'}`,
              chunkFileNames: `[name].${esmodule ? 'mjs' : 'js'}`,
              assetFileNames: '[name].[ext]',
            },
          },
        },
      } as UserConfig, viteConfig),
    }
    flatApiOptions.push(preload)
  }
  const plugins = electron(flatApiOptions)

  if (options.renderer) {
    try {
      const renderer = await import('vite-plugin-electron-renderer')
      plugins.push(renderer.default(options.renderer))
    } catch (error: any) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          `\`renderer\` option dependency "vite-plugin-electron-renderer" not found. Did you install it? Try \`npm i -D vite-plugin-electron-renderer\`.`,
        )
      }

      throw error
    }
  }

  return plugins
}

// Consider simple using built-in functions based on building standalone files.
function resolvePackageJson(root = process.cwd()): {
  type?: 'module' | 'commonjs'
  [key: string]: any
} | null {
  const packageJsonPath = path.join(root, 'package.json')
  const packageJsonStr = fs.readFileSync(packageJsonPath, 'utf8')
  try {
    return JSON.parse(packageJsonStr)
  } catch {
    return null
  }
}
