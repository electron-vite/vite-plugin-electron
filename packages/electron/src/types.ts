import type { PluginContext } from 'rollup'
import type { InlineConfig, LibraryOptions } from 'vite'

export type Configuration = {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry?: LibraryOptions['entry']
  /**
   * Triggered when Vite is built.  
   * If passed this parameter will not automatically start Electron App.  
   * You can start Electron App through the `startup` function passed through the callback function.  
   */
  onstart?: (this: PluginContext, startup: (args?: string[]) => Promise<void>) => void
  vite?: InlineConfig
}
