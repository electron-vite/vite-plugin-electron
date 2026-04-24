import { loadPackageJSONSync } from 'local-pkg'
import { build as viteBuild, createBuilder, mergeConfig, perEnvironmentPlugin, version } from 'vite'
import type {
  ConfigEnv,
  EnvironmentOptions,
  InlineConfig,
  Plugin,
  PluginOption,
  UserConfig,
  ViteDevServer,
} from 'vite'

import { triggerStartup } from './startup'
import {
  resolveServerUrl,
  resolveViteConfig,
  resolveViteEnvironmentConfig,
  resolveInput,
  setupMockHtml,
  withExternalBuiltins,
} from './utils'

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

const PLUGIN_PREFIX = 'vite-plugin-electron'

export function build(options: MultiEnvElectronOptions): ReturnType<typeof viteBuild> {
  return viteBuild(withExternalBuiltins(resolveViteConfig(options)))
}

export default function electron(
  options: MultiEnvElectronOptions | MultiEnvElectronOptions[],
): Plugin[] {
  const optionsArray = Array.isArray(options) ? options : [options]
  let userConfig: UserConfig
  let configEnv: ConfigEnv
  let cleanupMock: (() => Promise<void>) | undefined

  if (Number.parseInt(version) < 8) {
    throw new Error(
      `[vite-plugin-electron] Vite v${version} does not support \`rolldownOptions\`, please install \`vite@>=8\` or use \`vite-plugin-electron@0.29.1\`.`,
    )
  }

  const environmentOptions = optionsArray.map((opt, i) => {
    const name = `electron_${opt.name ?? i}`
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

  const isESM = loadPackageJSONSync()?.type === 'module'

  const createElectronBuilder = async (
    inheritedConfig: ElectronFlatSharedConfig,
    server?: ViteDevServer,
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
            const envCfg = resolveViteEnvironmentConfig(isESM, cfg)
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
              async configEnvironment(environmentName, environmentConfig, env) {
                if (environmentName !== name) {
                  return
                }

                const resolvedPlugins = await resolvePluginOptions(pluginOptions)
                let mergedConfig = environmentConfig

                // Proxy config hooks before Vite resolves per-environment plugins.
                for (const plugin of resolvedPlugins) {
                  const configHook = getHookHandler(plugin.config)

                  if (!configHook) {
                    continue
                  }

                  const configResult = await configHook.call(this, mergedConfig as any, env)
                  if (configResult) {
                    mergedConfig = mergeConfig(mergedConfig, configResult as any)
                  }
                }

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
                        triggerStartup(this, server, cfg)
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
    for (const [name] of environmentOptions) {
      await builder.build(builder.environments[name]!)
    }
  }

  return [
    {
      name: `${PLUGIN_PREFIX}:dev`,
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

        server.httpServer?.once('listening', async () => {
          Object.assign(process.env, { VITE_DEV_SERVER_URL: resolveServerUrl(server) })
          await createElectronBuilder(
            // reassign is required here
            {
              mode: server.config.mode,
              root: server.config.root,
              envDir: server.config.envDir,
              envPrefix: server.config.envPrefix,
            },
            server,
          )
        })
      },
    },
    {
      name: `${PLUGIN_PREFIX}:prod`,
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
        try {
          await createElectronBuilder({
            mode: configEnv.mode,
            root: userConfig.root,
            envDir: userConfig.envDir,
            envPrefix: userConfig.envPrefix,
          })
        } finally {
          // Remove mock files only after the Electron build has finished using them.
          if (cleanupMock) {
            await cleanupMock()
            cleanupMock = undefined
          }
        }
      },
    },
  ]
}
