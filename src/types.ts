import type {
  UserConfigExport,
  LibraryOptions,
} from 'vite'
import type { InputOption } from 'rollup'

export interface MainConfig {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry: LibraryOptions['entry']
  vite?: UserConfigExport
  nodeIntegration?: boolean
}

export interface PreloadConfig {
  /**
   * Shortcut of `build.rollupOptions.input`
   */
  input?: InputOption
  vite?: UserConfigExport
}

export interface Configuration {
  main: MainConfig
  preload?: PreloadConfig
}
