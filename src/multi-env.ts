import { createBuilder, mergeConfig, perEnvironmentPlugin } from 'vite'
import type { EnvironmentOptions, Plugin, ViteBuilder } from 'vite'

import { createElectronPlugin } from './base'
import { defaultPreloadOnstart, triggerStartup } from './startup'
import type { OnStartOptions } from './startup'
import {
  checkESModule,
  createDefaultPreloadConfig,
  createElectronViteDefaults,
  defaultMainSimpleConfig,
  withExternalBuiltins,
} from './utils'
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
  return Object.entries(options).map(([name, { options, ...rest }]) => {
    switch (name) {
      case 'main':
        return Object.assign(rest, {
          name,
          options: mergeConfig<EnvironmentOptions, EnvironmentOptions>(
            defaultMainSimpleConfig,
            options ?? {},
          ),
        })

      case 'preload':
        return Object.assign(rest, {
          name,
          onstart: rest.onstart || defaultPreloadOnstart,
          options: mergeConfig<EnvironmentOptions, EnvironmentOptions>(
            createDefaultPreloadConfig(checkESModule()),
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

export function electronSimple(options: MultiEnvElectronOptionsRecord): Plugin[] {
  return electron(simpleOptions(options))
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

  const isESM = checkESModule()

  // Shared: create per-environment EnvironmentOptions from the options array.
  const defaultEnvs = Object.fromEntries(
    environmentOptions.map((opt) => {
      const defaultConfig = createElectronViteDefaults(isESM, {
        input: opt.input,
        plugins: opt.plugins,
      })

      return [
        opt.name,
        mergeConfig<EnvironmentOptions, EnvironmentOptions>(
          { consumer: 'server', ...defaultConfig },
          opt.options ?? {},
        ),
      ]
    }),
  )

  // Build each electron environment from the given builder in declaration order.
  const buildElectronEnvironments = async (builder: ViteBuilder): Promise<void> => {
    for (const name of Object.keys(builder.environments)) {
      const env = builder.environments[name]
      if (env && !env.isBuilt) {
        await builder.build(env)
      }
    }
  }

  return createElectronPlugin({
    prefix: PLUGIN_PREFIX,
    async dev(pluginContext, server) {
      if (optionsArray.length === 0) {
        return
      }

      let builtCount = 0

      // In watch/dev mode, enable watching and disable minification.
      for (const envCfg of Object.values(defaultEnvs)) {
        envCfg.build ??= {}
        envCfg.build.watch ??= {}
        envCfg.build.minify ??= false
      }

      const builder = await createBuilder(
        withExternalBuiltins({
          configFile: false,
          publicDir: false,
          mode: server.config.mode,
          root: server.config.root,
          envDir: server.config.envDir,
          envPrefix: server.config.envPrefix,
          environments: defaultEnvs,
          plugins: environmentOptions.flatMap((opt) => {
            const name = opt.name
            return perEnvironmentPlugin(`${PLUGIN_PREFIX}:startup:${name}`, (ctx) => {
              if (ctx.name !== name) {
                return false
              }
              return {
                name: `${PLUGIN_PREFIX}:startup-hook:${name}`,
                closeBundle() {
                  if (++builtCount < optionsArray.length) {
                    return
                  }
                  triggerStartup(pluginContext, server, opt)
                },
              }
            })
          }),
        }),
      )

      await buildElectronEnvironments(builder)
    },
    // Build is fully handled by the config() hook, so we can leave this empty.
    async build() {},
    // Use the config() hook to inject electron environments
    buildConfig(config) {
      if (optionsArray.length === 0) {
        return
      }

      return withExternalBuiltins({
        environments: defaultEnvs,
        builder: {
          async buildApp(builder) {
            const prevBuildApp = config.builder?.buildApp
            if (prevBuildApp) {
              await prevBuildApp.call(this, builder)
            }

            // Let the user's buildApp run first so the mock HTML remains available.
            await buildElectronEnvironments(builder)
          },
        },
      })
    },
  })
}
