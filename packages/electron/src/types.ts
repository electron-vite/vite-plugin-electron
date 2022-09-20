import type { InlineConfig, LibraryOptions } from 'vite'
import type { InputOption } from 'rollup'
import { Options } from 'vite-plugin-electron-renderer'

export interface CommonConfiguration {
  vite?: InlineConfig
  /**
   * Explicitly include/exclude some CJS modules  
   * `modules` includes `dependencies` of package.json, Node.js's `builtinModules` and `electron`  
   */
  resolve?: (modules: string[]) => typeof modules | undefined
}

export interface Configuration {
  main: CommonConfiguration & {
    /**
     * Shortcut of `build.lib.entry`
     */
    entry: LibraryOptions['entry']
  }
  preload?: CommonConfiguration & {
    /**
     * Shortcut of `build.rollupOptions.input`
     */
    input: InputOption
  }
  worker?: CommonConfiguration & {
    input: InputOption
  }
  /**
   * Support use Node.js API in Electron-Renderer
   * @see https://github.com/electron-vite/vite-plugin-electron/tree/main/packages/electron-renderer
   */
  renderer?: Options
}
