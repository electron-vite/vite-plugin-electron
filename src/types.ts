import type { LibraryOptions, UserConfig } from 'vite'
import type { InputOption } from 'rollup'
import type { VitePluginElectronRenderer } from 'vite-plugin-electron-renderer'

export interface Configuration {
  main: {
    /**
     * Shortcut of `build.lib.entry`
     */
    entry: LibraryOptions['entry']
    vite?: UserConfig
  }
  preload?: {
    /**
     * Shortcut of `build.rollupOptions.input`
     */
    input: InputOption
    vite?: UserConfig
  }
  /**
   * Support use Node.js API in Electron-Renderer
   * @see https://github.com/electron-vite/vite-plugin-electron-renderer
   */
  renderer?: Parameters<VitePluginElectronRenderer>[0]
}
