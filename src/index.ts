import { build as viteBuild, mergeConfig } from 'vite'
import type { Plugin, LibraryOptions, InlineConfig } from 'vite'

import { closeWatchers, createElectronPlugin } from './base'
import { triggerStartup } from './startup'
import type { OnStartOptions } from './startup'
import { checkESModule, resolveViteConfigBase, withExternalBuiltins } from './utils'

// public utils
export { startup } from './startup'
export {
  resolveViteConfig,
  withExternalBuiltins,
  compatRollupOptions,
  checkESModule,
} from './utils'
export type { RolldownOrRollupOptions } from './utils'
export { loadPackageJSON, loadPackageJSONSync } from 'local-pkg'

export interface ElectronOptions extends OnStartOptions {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry?: LibraryOptions['entry']
  vite?: InlineConfig
}

export function build(options: ElectronOptions): ReturnType<typeof viteBuild> {
  return buildBase(checkESModule(), options)
}

function buildBase(isESM: boolean, options: ElectronOptions): ReturnType<typeof viteBuild> {
  return viteBuild(withExternalBuiltins(resolveViteConfigBase(isESM, options)))
}

export default function electron(options: ElectronOptions | ElectronOptions[]): Plugin[] {
  const optionsArray = Array.isArray(options) ? options : [options]

  return createElectronPlugin({
    prefix: 'vite-plugin-electron',
    async dev(pluginContext, server, isESM, session) {
      const entryCount = optionsArray.length
      let closeBundleCount = 0
      const watchers: { close: () => Promise<void> }[] = []

      try {
        for (const originalOptions of optionsArray) {
          const options = { ...originalOptions, vite: mergeConfig({}, originalOptions.vite ?? {}) }
          options.vite.mode ??= server.config.mode
          options.vite.root ??= server.config.root
          options.vite.envDir ??= server.config.envDir
          options.vite.envPrefix ??= server.config.envPrefix

          options.vite.build ??= {}
          if (!('watch' in options.vite.build)) {
            // #252
            options.vite.build.watch = {}
          }
          options.vite.build.minify ??= false

          options.vite.plugins = [
            ...(options.vite.plugins ?? []),
            {
              name: ':startup',
              closeBundle() {
                if (++closeBundleCount < entryCount) {
                  return
                }
                triggerStartup(pluginContext, server, options, session)
              },
            },
          ]

          const result = await buildBase(isESM, options)
          if ('close' in result) {
            watchers.push(result)
          }
        }
      } catch (error) {
        await closeWatchers(watchers).catch(() => {})
        throw error
      }

      return async () => {
        await closeWatchers(watchers)
      }
    },
    async build(userConfig, configEnv, isESM) {
      for (const options of optionsArray) {
        options.vite ??= {}
        options.vite.mode ??= configEnv.mode
        options.vite.root ??= userConfig.root
        options.vite.envDir ??= userConfig.envDir
        options.vite.envPrefix ??= userConfig.envPrefix
        await buildBase(isESM, options)
      }
    },
  })
}
