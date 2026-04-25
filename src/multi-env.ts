import { build as viteBuild, createBuilder, mergeConfig, perEnvironmentPlugin } from 'vite'
import type {
  EnvironmentOptions,
  InlineConfig,
  Plugin,
  PluginOption,
  ViteDevServer,
  MinimalPluginContextWithoutEnvironment,
} from 'vite'

import { createElectronPlugin } from './base'
import { triggerStartup } from './startup'
import { resolveViteConfig, resolveViteConfigBase, withExternalBuiltins } from './utils'

import type { ElectronOptions } from '.'

export interface MultiEnvElectronOptions extends ElectronOptions {
  /**
   * Optional name for the Electron environment.
   *
   * By default, the plugin will generate environment names like `electron_0`,
   * `electron_1`, etc. based on the order of the options provided.
   */
  name?: string
}

type ElectronFlatSharedConfig = Pick<InlineConfig, 'envDir' | 'envPrefix' | 'mode' | 'root'>

async function resolvePluginOptions(pluginOption: PluginOption): Promise<Plugin[]> {
  const resolvedOption = await pluginOption

  if (!resolvedOption) {
    return []
  }

  if (Array.isArray(resolvedOption)) {
    const plugins: Plugin[] = []

    for (const option of resolvedOption) {
      plugins.push(...(await resolvePluginOptions(option)))
    }

    return plugins
  }

  return [resolvedOption]
}

function getHookHandler<T extends (...args: any[]) => any>(
  hook: T | { handler: T } | undefined,
): T | undefined {
  if (!hook) {
    return undefined
  }

  return typeof hook === 'function' ? hook : hook.handler
}

const PLUGIN_PREFIX = 'vite-plugin-electron-multi-env'

export function build(options: MultiEnvElectronOptions): ReturnType<typeof viteBuild> {
  return viteBuild(withExternalBuiltins(resolveViteConfig(options)))
}

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
    const { plugins, define, resolve, optimizeDeps, build } = opt.vite ?? {}
    const envOpts: EnvironmentOptions = { define, resolve, optimizeDeps, build }
    const hasOpts = Object.values(envOpts).some((v) => v !== undefined)

    return [
      name,
      {
        name,
        entry: opt.entry,
        options: hasOpts ? envOpts : undefined,
        plugins,
        onstart: opt.onstart,
      },
    ] as const
  })

  const createElectronBuilder = async (
    isESM: boolean,
    inheritedConfig: ElectronFlatSharedConfig,
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
          environmentOptions.map(([name, cfg]) => {
            const envCfg: EnvironmentOptions = resolveViteConfigBase(isESM, {
              entry: cfg.entry,
              vite: cfg.options,
            })
            envCfg.consumer = 'server'
            if (server) {
              envCfg.build ??= {}
              envCfg.build.watch ??= {}
              envCfg.build.minify ??= false
            }
            return [name, envCfg]
          }),
        ),
        plugins: environmentOptions.flatMap(([name, cfg]) => {
          const plugins: Plugin[] = []

          if (cfg.plugins) {
            const pluginOptions = cfg.plugins

            plugins.push({
              name: `${PLUGIN_PREFIX}:plugins:${name}`,
              applyToEnvironment(environment) {
                return environment.name === name ? pluginOptions : false
              },
              async config(config, env) {
                const resolvedPlugins = await resolvePluginOptions(pluginOptions)
                let mergedConfig = {}
                let environmentMergedConfig = {}
                let configInput = mergeConfig({}, config)

                for (const plugin of resolvedPlugins) {
                  const configHook = getHookHandler(plugin.config)

                  if (!configHook) {
                    continue
                  }

                  const configResult = await configHook.call(this, configInput, env)
                  if (configResult) {
                    // Keep root-level fields on the top-level config so Vite sees them
                    // before the asset pipeline resolves, but scope Electron-specific
                    // fields to the generated environment.
                    const { define, resolve, optimizeDeps, build, ...rootConfigResult } =
                      configResult

                    if (Object.keys(rootConfigResult).length > 0) {
                      mergedConfig = mergeConfig(mergedConfig, rootConfigResult)
                    }

                    const environmentConfigResult = {
                      ...(define !== undefined ? { define } : {}),
                      ...(resolve !== undefined ? { resolve } : {}),
                      ...(optimizeDeps !== undefined ? { optimizeDeps } : {}),
                      ...(build !== undefined ? { build } : {}),
                    }

                    if (Object.keys(environmentConfigResult).length > 0) {
                      environmentMergedConfig = mergeConfig(
                        environmentMergedConfig,
                        environmentConfigResult,
                      )
                    }

                    configInput = mergeConfig(configInput, configResult)
                  }
                }

                if (
                  Object.keys(mergedConfig).length === 0 &&
                  Object.keys(environmentMergedConfig).length === 0
                ) {
                  return
                }

                const configResult: Record<string, unknown> = {
                  ...mergedConfig,
                }

                if (Object.keys(environmentMergedConfig).length > 0) {
                  configResult.environments = {
                    [name]: environmentMergedConfig,
                  }
                }

                return configResult
              },
              // configEnvironment runs after applyToEnvironment selects the target
              // environment, so it only needs to proxy the environment-specific hook.
              async configEnvironment(environmentName, environmentConfig, env) {
                if (environmentName !== name) {
                  return
                }

                const resolvedPlugins = await resolvePluginOptions(pluginOptions)
                let mergedConfig = environmentConfig

                for (const plugin of resolvedPlugins) {
                  const configEnvironmentHook = getHookHandler(plugin.configEnvironment)

                  if (!configEnvironmentHook) {
                    continue
                  }

                  const configEnvironmentResult = await configEnvironmentHook.call(
                    this,
                    environmentName,
                    mergedConfig,
                    env,
                  )

                  if (configEnvironmentResult) {
                    mergedConfig = mergeConfig(mergedConfig, configEnvironmentResult)
                  }
                }

                // Mutate in place so Vite does not deep-merge array fields like build.lib.formats again.
                Object.assign(environmentConfig, mergedConfig)
              },
            })
          }

          if (server) {
            plugins.push(
              perEnvironmentPlugin(`${PLUGIN_PREFIX}:startup:${name}`, (ctx) =>
                ctx.name === name
                  ? {
                      name: `${PLUGIN_PREFIX}:startup-hook:${name}`,
                      closeBundle() {
                        if (++builtCount < optionsArray.length) {
                          return
                        }
                        triggerStartup(context!, server, cfg)
                      },
                    }
                  : false,
              ),
            )
          }

          return plugins
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
