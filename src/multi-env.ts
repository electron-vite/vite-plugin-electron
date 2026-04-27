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
            createDefaultPreloadConfig(checkESModule(), rest.input),
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

  const isESM = checkESModule()

  // Shared: create per-environment EnvironmentOptions from the options array.
  const createEnvironments = (): Record<string, EnvironmentOptions> =>
    Object.fromEntries(
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

  // Set to true when buildApp takes ownership of the electron builds so that
  // the closeBundle-based fallback (used by the programmatic build() API) skips
  // them and avoids a double-build.
  let electronBuiltViaApp = false

  // Build each electron environment from the given builder in declaration order.
  const buildElectronEnvironments = async (builder: ViteBuilder): Promise<void> => {
    for (const name of envNames) {
      const env = builder.environments[name]
      if (env) await builder.build(env)
    }
  }

  return [
    // Build mode: use the config() hook to inject electron environments and
    // set builder.buildApp so Vite's CLI builds the renderer app first, then
    // the electron environments.
    {
      name: `${PLUGIN_PREFIX}:config`,
      apply: 'build',
      config(config) {
        if (optionsArray.length === 0) {
          return
        }

        // Apply external builtins scoped to the electron environments only,
        // then merge them into the main config's environments map.
        const envsCfg = withExternalBuiltins({ environments: createEnvironments() })
        config.environments ??= {}
        Object.assign(config.environments, envsCfg.environments)

        // Override buildApp to build renderer environments first, then the
        // electron environments. This preserves the previous behaviour where
        // the renderer app is always built before the Electron main/preload.
        const prevBuildApp = config.builder?.buildApp
        config.builder ??= {}
        config.builder.buildApp = async (builder) => {
          // Claim ownership of the electron builds up-front so that the
          // closeBundle-based fallback (below) does not run them a second time.
          electronBuiltViaApp = true

          if (prevBuildApp) {
            // Delegate all builds (renderer + any user-defined environments) to
            // the existing handler, then append the electron builds. The user's
            // handler is responsible for every environment it registered; we only
            // add the electron environments that we injected.
            await prevBuildApp(builder)
          } else {
            for (const [name, env] of Object.entries(builder.environments)) {
              if (!envNames.has(name)) {
                await builder.build(env)
              }
            }
          }

          await buildElectronEnvironments(builder)
        }
      },
    },

    // Dev/cleanup base plugins (mock-html handling, server listening, …).
    ...createElectronPlugin({
      prefix: PLUGIN_PREFIX,
      async dev(pluginContext, server) {
        if (optionsArray.length === 0) {
          return
        }

        let builtCount = 0
        const environments = createEnvironments()

        // In watch/dev mode, enable watching and disable minification.
        for (const envCfg of Object.values(environments)) {
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
            environments,
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
      // Fallback for Vite's programmatic build() API, which skips buildApp and
      // only builds the first (client) environment via closeBundle. When the
      // CLI-driven buildApp path already ran, this is a no-op.
      async build(userConfig, configEnv) {
        if (electronBuiltViaApp || optionsArray.length === 0) {
          return
        }

        const envsCfg = withExternalBuiltins({ environments: createEnvironments() })
        const builder = await createBuilder({
          configFile: false,
          publicDir: false,
          mode: configEnv.mode,
          root: userConfig.root,
          envDir: userConfig.envDir,
          envPrefix: userConfig.envPrefix,
          environments: envsCfg.environments,
        })

        await buildElectronEnvironments(builder)
      },
    }),
  ]
}
