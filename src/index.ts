import { build as viteBuild, version } from 'vite'
import type { Plugin, ConfigEnv, UserConfig } from 'vite'

import { triggerStartup } from './startup'
import type { OnStartOptions } from './startup'
import {
  resolveServerUrl,
  resolveViteConfig,
  resolveInput,
  setupMockHtml,
  withExternalBuiltins,
} from './utils'

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
  let userConfig: UserConfig
  let configEnv: ConfigEnv
  let cleanupMock: (() => Promise<void>) | undefined

  if (Number.parseInt(version) < 8) {
    throw new Error(
      `[vite-plugin-electron] Vite v${version} does not support \`rolldownOptions\`, please install \`vite@>=8\` or use \`vite-plugin-electron@0.29.1\`.`,
    )
  }

  return [
    {
      name: 'vite-plugin-electron:dev',
      apply: 'serve',
      configResolved(config) {
        // When there is no entry (no index.html and no configured input), write a
        // temporary mock so that Vite's dev server starts without errors.
        if (!resolveInput(config)) {
          cleanupMock = setupMockHtml(config, false, config.logger)
        }
      },
      configureServer(server) {
        server.httpServer?.once('close', async () => {
          if (cleanupMock) {
            await cleanupMock()
            cleanupMock = undefined
          }
        })

        server.httpServer?.once('listening', () => {
          Object.assign(process.env, {
            VITE_DEV_SERVER_URL: resolveServerUrl(server),
          })

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
                triggerStartup(this, server, options)
              },
            })
            build(options)
          }
        })
      },
    },
    {
      name: 'vite-plugin-electron:prod',
      apply: 'build',
      config(config, env) {
        userConfig = config
        configEnv = env

        // Make sure that Electron can be loaded into the local file using `loadFile` after packaging.
        config.base ??= './'
      },
      configResolved(config) {
        // When there is no entry (no index.html and no configured input), write a
        // temporary mock so that Vite's build has a valid entry point.
        if (!resolveInput(config)) {
          cleanupMock = setupMockHtml(config, true, config.logger)
        }
      },
      async closeBundle() {
        for (const options of optionsArray) {
          options.vite ??= {}
          options.vite.mode ??= configEnv.mode
          options.vite.root ??= userConfig.root
          options.vite.envDir ??= userConfig.envDir
          options.vite.envPrefix ??= userConfig.envPrefix
          await build(options)
        }

        // Remove mock files created in configResolved before building Electron.
        if (cleanupMock) {
          await cleanupMock()
          cleanupMock = undefined
        }
      },
    },
  ]
}
