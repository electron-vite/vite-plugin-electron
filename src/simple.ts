import { mergeConfig } from 'vite'
import type { Plugin } from 'vite'

import type { RendererOptions } from './renderer'
import { defaultPreloadOnstart } from './startup'
import { checkESModule, createDefaultPreloadConfig, defaultMainSimpleConfig } from './utils'
import type { RolldownOptions } from './utils'

import electron from './index'
import type { ElectronOptions } from './index'

export interface ElectronSimpleOptions {
  main: ElectronOptions
  preload?: Omit<ElectronOptions, 'entry'> & {
    /**
     * Shortcut of `build.rolldownOptions.input`.
     *
     * Preload scripts may contain Web assets, so use the `build.rolldownOptions.input` instead `build.lib.entry`.
     */
    input: RolldownOptions['input']
  }
  /**
   * Support use Node.js API in Electron-Renderer with the built-in renderer plugin.
   */
  renderer?: RendererOptions
}

// The simple API just like v0.9.x
// Vite v3.x support async plugin.
export default async function electronSimple(options: ElectronSimpleOptions): Promise<Plugin[]> {
  const esmodule = checkESModule()
  const flatApiOptions = [
    mergeConfig<ElectronOptions, ElectronOptions>({ vite: defaultMainSimpleConfig }, options.main),
  ]

  if (options.preload) {
    const { input, vite: viteConfig = {}, ...preloadOptions } = options.preload
    const preloadConfig = createDefaultPreloadConfig(esmodule, input)
    const preload: ElectronOptions = {
      onstart: defaultPreloadOnstart,
      ...preloadOptions,
      vite: mergeConfig(preloadConfig, viteConfig),
    }
    flatApiOptions.push(preload)
  }

  const plugins = electron(flatApiOptions)

  if (options.renderer) {
    const renderer = await import('./renderer')
    plugins.push(renderer.default(options.renderer))
  }

  return plugins
}
