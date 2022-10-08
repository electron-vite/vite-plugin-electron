import type { InlineConfig, LibraryOptions } from 'vite'

export type Configuration = {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry?: LibraryOptions['entry']
  vite?: InlineConfig
}
