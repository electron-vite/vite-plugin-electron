import { createBuilder, mergeConfig, perEnvironmentPlugin } from 'vite'
import type {
  EnvironmentOptions,
  Plugin,
  ViteDevServer,
  InlineConfig,
  MinimalPluginContextWithoutEnvironment,
} from 'vite'

import { createElectronPlugin } from './base'
import { triggerStartup } from './startup'
import type { OnStartOptions } from './startup'
import { checkESModule, withExternalBuiltins } from './utils'
import type { RolldownOptions } from './utils'

export type MultiEnvElectronOptionName = 'main' | 'preload' | (string & {})

export interface MultiEnvElectronOptions extends OnStartOptions {
  /**
   * Optional name for the Electron environment `electron_${name}`.
   *
   * By default, the plugin will generate environment names like `electron_0`,
   * `electron_1`, etc. based on the order of the options provided.
   */
  name?: string
  /**
   * Shortcut of `options.build.rolldownOptions.input`
   */
  input?: RolldownOptions['input']
  /**
   * Shortcut of `options.build.rolldownOptions.plugins`
   */
  plugins?: RolldownOptions['plugins']
  /**
   * Per-environment Vite options.
   */
  options?: EnvironmentOptions
}

export type MultiEnvElectronOptionsRecord = Record<
  MultiEnvElectronOptionName,
  Omit<MultiEnvElectronOptions, 'name'>
>

/**
 * Helper function to create simple API for {@link electron} like `vite-plugin-electron/simple`.
 */
export function simpleOptions(options: MultiEnvElectronOptionsRecord): MultiEnvElectronOptions[] {
  const esmodule = checkESModule()
  const fileExt = esmodule ? 'mjs' : 'js'
  // todo)) extract common options from `electronSimple` instead of creating manually
  return Object.entries(options).map(([name, { options, ...rest }]) => {
    switch (name) {
      case 'main':
        return Object.assign(rest, {
          name,
          options: mergeConfig<EnvironmentOptions, EnvironmentOptions>(
            {
              build: {
                rolldownOptions: {
                  platform: 'node',
                },
              },
            },
            options ?? {},
          ),
        })

      case 'preload':
        return Object.assign(rest, {
          name,
          onstart(args: Parameters<NonNullable<MultiEnvElectronOptions['onstart']>>[0]) {
            args.reload()
          },
          options: mergeConfig<EnvironmentOptions, EnvironmentOptions>(
            {
              build: {
                rolldownOptions: {
                  platform: 'node',
                  output: {
                    format: 'cjs',
                    codeSplitting: false,
                    entryFileNames: `[name].${fileExt}`,
                    chunkFileNames: `[name].${fileExt}`,
                    assetFileNames: '[name].[ext]',
                  },
                },
              },
            },
            options ?? {},
          ),
        })

      default:
        return Object.assign(rest, {
          name,
          options,
        })
    }
  })
}

const PLUGIN_PREFIX = 'vite-plugin-electron-multi-env'

export default function electron(
  options: MultiEnvElectronOptions | MultiEnvElectronOptions[],
): Plugin[] {
  const optionsArray = Array.isArray(options) ? options : [options]
  const envNames = new Set<string>()
  const environmentOptions = optionsArray.map((opt, i) => {
    const name = `electron_${opt.name || i}`
    if (envNames.has(name)) {
      throw new Error(
        `[vite-plugin-electron] Duplicate environment name "${name}". Please provide unique "name" properties for each environment in the options array.`,
      )
    }
    envNames.add(name)

    return { ...opt, name } as const
  })

  const createElectronBuilder = async (
    isESM: boolean,
    inheritedConfig: InlineConfig,
    server?: ViteDevServer,
    context?: MinimalPluginContextWithoutEnvironment,
  ) => {
    if (optionsArray.length === 0) {
      return
    }

    let builtCount = 0
    const builder = await createBuilder(
      withExternalBuiltins({
        configFile: false,
        publicDir: false,
        ...inheritedConfig,
        environments: Object.fromEntries(
          environmentOptions.map((opt) => {
            const envCfg = mergeConfig<EnvironmentOptions, EnvironmentOptions>(
              {
                consumer: 'server',
                build: {
                  outDir: 'dist-electron',
                  emptyOutDir: false,
                  rolldownOptions: {
                    input: opt.input,
                    plugins: opt.plugins,
                    platform: 'node',
                    output: {
                      format: isESM ? 'es' : 'cjs',
                    },
                  },
                },
                resolve: {
                  conditions: ['node'],
                  // #98
                  // Since we're building for electron (which uses Node.js), we don't want to use the "browser" field in the packages.
                  // It corrupts bundling packages like `ws` and `isomorphic-ws`, for example.
                  mainFields: ['module', 'jsnext:main', 'jsnext'],
                },
                define: {
                  // @see - https://github.com/vitejs/vite/blob/v5.0.11/packages/vite/src/node/plugins/define.ts#L20
                  'process.env': 'process.env',
                },
              },
              opt.options ?? {},
            )
            if (server) {
              envCfg.build ??= {}
              envCfg.build.watch ??= {}
              envCfg.build.minify ??= false
            }
            return [opt.name, envCfg]
          }),
        ),
        plugins: environmentOptions.flatMap((opt) => {
          const name = opt.name
          return server
            ? perEnvironmentPlugin(`${PLUGIN_PREFIX}:startup:${name}`, (ctx) => {
                if (ctx.name !== name) {
                  return false
                }
                return {
                  name: `${PLUGIN_PREFIX}:startup-hook:${name}`,
                  closeBundle() {
                    if (++builtCount < optionsArray.length) {
                      return
                    }
                    triggerStartup(context!, server, opt)
                  },
                }
              })
            : null
        }),
      }),
    )

    // Build only the Electron environments; the renderer app has already been
    // built by the outer Vite command.
    for (const name of envNames) {
      await builder.build(builder.environments[name]!)
    }
  }

  return createElectronPlugin({
    prefix: PLUGIN_PREFIX,
    async dev(pluginContext, server, isESM) {
      await createElectronBuilder(
        isESM,
        // reassign is required here
        {
          mode: server.config.mode,
          root: server.config.root,
          envDir: server.config.envDir,
          envPrefix: server.config.envPrefix,
        },
        server,
        pluginContext,
      )
    },
    async build(userConfig, configEnv, isESM) {
      await createElectronBuilder(isESM, {
        mode: configEnv.mode,
        root: userConfig.root,
        envDir: userConfig.envDir,
        envPrefix: userConfig.envPrefix,
      })
    },
  })
}
