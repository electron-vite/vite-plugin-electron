import type {
  UserConfigExport,
  LibraryOptions,
} from 'vite'
import type { InputOption } from 'rollup'

export interface MainConfig {
  /** Alias of build.lib.entry */
  entry: LibraryOptions['entry']
  vite?: UserConfigExport
  nodeIntegration?: boolean
}

export interface PreloadConfig {
  // TODO: 
  entry: InputOption
  vite?: UserConfigExport
}

export interface Configuration {
  main: MainConfig
  preload?: PreloadConfig
}
