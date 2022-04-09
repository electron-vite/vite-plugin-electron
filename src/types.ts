import type {
  LibraryOptions,
  UserConfig,
} from 'vite'
import type { InputOption } from 'rollup'

export interface MainConfig {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry: LibraryOptions['entry']
  vite?: UserConfig
  nodeIntegration?: boolean
}

export interface PreloadConfig {
  /**
   * Shortcut of `build.rollupOptions.input`
   */
  input?: InputOption
  vite?: UserConfig
}

export interface Configuration {
  main: MainConfig
  preload?: PreloadConfig
}
