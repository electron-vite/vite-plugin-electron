import {
  UserConfigExport,
  LibraryOptions,
} from 'vite'

export interface GeneralConfig {
  /** Alias of build.lib.entry */
  entry: LibraryOptions['entry']
  vite?: UserConfigExport
}

export interface MainConfig extends GeneralConfig {
  nodeIntegration?: boolean
}

export interface PreloadConfig extends GeneralConfig {
}

export interface Configuration {
  main: MainConfig
  preload?: PreloadConfig
}
