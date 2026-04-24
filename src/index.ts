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
  LibraryOptions,
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

// public utils
export { startup } from './startup'
export { resolveViteConfig, withExternalBuiltins } from './utils'
export { loadPackageJSON, loadPackageJSONSync } from 'local-pkg'

export interface ElectronOptions {
  /**
   * Optional name for the Electron environment.
   *
   * By default, the plugin will generate environment names like `electron_0`,
   * `electron_1`, etc. based on the order of the options provided.
   */
  name?: string
  /**
   * Shortcut of `build.lib.entry`
   */
  entry?: import('vite').LibraryOptions['entry']
  vite?: import('vite').InlineConfig
  /**
   * Triggered when Vite is built every time -- `vite serve` command only.
   *
   * If this `onstart` is passed, Electron App will not start automatically.
   * However, you can start Electroo App via `startup` function.
   */
  onstart?: (args: {
    /**
     * Electron App startup function.
     * It will mount the Electron App child-process to `process.electronApp`.
     * @param argv default value `['.', '--no-sandbox']`
     * @param options options for `child_process.spawn`, with default cwd of the Vite project root
     * @param customElectronPkg custom electron package name (default: 'electron')
     */
    startup: (
      argv?: string[],
      options?: import('node:child_process').SpawnOptions,
      customElectronPkg?: string,
    ) => Promise<void>
    /** Reload Electron-Renderer */
    reload: () => void
  }) => void | Promise<void>
}

type ElectronFlatEnvironmentConfig = {
  /**
   * Shortcut of `options.build.lib.entry`
   */
  entry?: LibraryOptions['entry']
  /**
   * Vite environment options for this Electron build target.
   */
  options?: EnvironmentOptions
  /**
   * Plugins scoped to this environment only.
   */
  plugins?: PluginOption
  /**
   * Triggered when this environment finishes building in `vite serve`.
   */
  onstart?: ElectronOptions['onstart']
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

  const sharedConfig: ElectronFlatSharedConfig = {}
  for (const key of ['root', 'mode', 'envDir', 'envPrefix'] as const) {
    for (const opt of optionsArray) {
      if (opt.vite?.[key] !== undefined) {
        sharedConfig[key] = opt.vite[key] as any
      }
    }
  }

  const environments: Record<string, ElectronFlatEnvironmentConfig> = {}
  for (const [i, opt] of optionsArray.entries()) {
    const name = `electron_${opt.name ?? i}`
    if (environments[name]) {
      throw new Error(`[${PLUGIN_PREFIX}] Duplicate environment: "${name}"`)
    }

    const { plugins, define, resolve, optimizeDeps, build } = opt.vite ?? {}
    const envOpts: EnvironmentOptions = { define, resolve, optimizeDeps, build }
    const hasOpts = Object.values(envOpts).some((v) => v !== undefined)

    environments[name] = {
      entry: opt.entry,
      options: hasOpts ? envOpts : undefined,
      plugins,
      onstart: opt.onstart,
    }
  }

  const envEntries = Object.entries(environments)
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
        ...sharedConfig,
        ...inheritedConfig,
        environments: Object.fromEntries(
          envEntries.map(([name, cfg]) => {
            const envCfg = resolveViteEnvironmentConfig(isESM, cfg)
            if (server) {
              envCfg.build ??= {}
              envCfg.build.watch ??= {}
              envCfg.build.minify ??= false
            }
            return [name, envCfg]
          }),
        ),
        plugins: envEntries.flatMap(([name, cfg]) => {
          const plugins: Plugin[] = []

          if (cfg.plugins) {
            const pluginOptions = cfg.plugins

            plugins.push({
              name: `${PLUGIN_PREFIX}:plugins:${name}`,
              applyToEnvironment(ctx) {
                return ctx.name === name ? pluginOptions : false
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
    for (const [name] of envEntries) {
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
