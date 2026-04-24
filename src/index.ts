import { build as viteBuild } from 'vite'
import type { Plugin } from 'vite'

import { createElectronPlugin } from './base'
import { triggerStartup } from './startup'
import type { OnStartOptions } from './startup'
import { resolveViteConfig, withExternalBuiltins } from './utils'

// public utils
export { startup } from './startup'
export { resolveViteConfig, withExternalBuiltins } from './utils'
export { loadPackageJSON, loadPackageJSONSync } from 'local-pkg'

export interface ElectronOptions extends OnStartOptions {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry?: import('vite').LibraryOptions['entry']
  vite?: import('vite').InlineConfig
}

export function build(options: ElectronOptions): ReturnType<typeof viteBuild> {
  return viteBuild(withExternalBuiltins(resolveViteConfig(options)))
}

export default function electron(options: ElectronOptions | ElectronOptions[]): Plugin[] {
  const optionsArray = Array.isArray(options) ? options : [options]
  return createElectronPlugin({
    prefix: 'vite-plugin-electron',
    dev(pluginContext, server) {
      const entryCount = optionsArray.length
      let closeBundleCount = 0

      for (const options of optionsArray) {
        options.vite ??= {}
        options.vite.mode ??= server.config.mode
        options.vite.root ??= server.config.root
        options.vite.envDir ??= server.config.envDir
        options.vite.envPrefix ??= server.config.envPrefix

        options.vite.build ??= {}
        if (!Object.keys(options.vite.build).includes('watch')) {
          // #252
          options.vite.build.watch = {}
        }
        options.vite.build.minify ??= false

        options.vite.plugins ??= []
        options.vite.plugins.push({
          name: ':startup',
          closeBundle() {
            if (++closeBundleCount < entryCount) {
              return
            }
            triggerStartup(pluginContext, server, options)
          },
        })
        build(options)
      }
    },
    async build(userConfig, configEnv) {
      for (const options of optionsArray) {
        options.vite ??= {}
        options.vite.mode ??= configEnv.mode
        options.vite.root ??= userConfig.root
        options.vite.envDir ??= userConfig.envDir
        options.vite.envPrefix ??= userConfig.envPrefix
        await build(options)
      }
    },
  })
}
