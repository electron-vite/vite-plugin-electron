import type { LibraryOptions, UserConfig } from 'vite'
import type { InputOption } from 'rollup'

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
}
