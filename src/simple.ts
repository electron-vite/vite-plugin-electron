import { mergeConfig } from 'vite'
import type { Plugin } from 'vite'

import { defaultPreloadOnstart } from './startup'
import { checkESModule, createDefaultPreloadConfig } from './utils'
import type { RolldownOrRollupOptions } from './utils'

import electron, { compatRollupOptions } from './index'
import type { ElectronOptions } from './index'

export interface ElectronSimpleOptions {
  main: ElectronOptions
  preload?: Omit<ElectronOptions, 'entry'> & {
    /**
     * Shortcut of `build.rolldownOptions.input` (`build.rollupOptions.input` on Vite < 8).
     *
     * Preload scripts may contain Web assets, so use the build input option instead of `build.lib.entry`.
     */
    input: RolldownOrRollupOptions['input']
  }
  /**
   * Support use Node.js API in Electron-Renderer
   * @see https://github.com/electron-vite/vite-plugin-electron-renderer
   */
  renderer?: import('vite-plugin-electron-renderer').RendererOptions
}

// The simple API just like v0.9.x
// Vite v3.x support async plugin.
export default async function electronSimple(options: ElectronSimpleOptions): Promise<Plugin[]> {
  const esmodule = checkESModule()
  const flatApiOptions = [
    mergeConfig<ElectronOptions, ElectronOptions>(
      {
        vite: {
          build: compatRollupOptions({
            rolldownOptions: {
              platform: 'node',
            },
          }),
        },
      },
      options.main,
    ),
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
    try {
      const renderer = await import('vite-plugin-electron-renderer')
      plugins.push(renderer.default(options.renderer))
    } catch (error: any) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          `\`renderer\` option depends on "vite-plugin-electron-renderer". Did you install it? Try \`npm i -D vite-plugin-electron-renderer\`.`,
        )
      }

      throw error
    }
  }

  return plugins
}
