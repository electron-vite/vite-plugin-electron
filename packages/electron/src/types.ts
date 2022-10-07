import type { InlineConfig, LibraryOptions } from 'vite'

export type Configuration = {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry?: LibraryOptions['entry']
  /**
   * Explicitly include/exclude some CJS modules  
   * `modules` includes `dependencies` of package.json, Node.js's `builtinModules` and `electron`  
   */
  resolve?: (modules: string[]) => typeof modules | undefined
  vite?: InlineConfig
}
