import { loadPackageJSONSync } from 'local-pkg'
import { createBuilder, mergeConfig, perEnvironmentPlugin } from 'vite'
import type { EnvironmentOptions, Plugin, ViteBuilder } from 'vite'

import { createElectronPlugin } from './base'
import { defaultPreloadOnstart, triggerStartup } from './startup'
import type { OnStartOptions } from './startup'
import {
  checkESModule,
  compatRollupOptions,
  createDefaultPreloadConfig,
  createElectronViteDefaults,
  toArray,
  withExternalBuiltins,
} from './utils'
import type { RolldownOrRollupOptions } from './utils'
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
   * Shortcut of `options.build.rolldownOptions.input` (`options.build.rollupOptions.input` on Vite < 8)
   */
  input?: RolldownOrRollupOptions['input']
  /**
   * Shortcut of `options.build.rolldownOptions.plugins` (`options.build.rollupOptions.plugins` on Vite < 8)
   */
  plugins?: RolldownOrRollupOptions['plugins']
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
            {
              build: compatRollupOptions({
                rolldownOptions: {
                  platform: 'node',
                },
              }),
            },
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

export interface ElectronFactoryContext {
  root: string
  packageJson?: ReturnType<typeof loadPackageJSONSync>
  isDev: boolean
}

export type MultiEnvElectronOptionsFactory = (
  context: ElectronFactoryContext,
) =>
  | MultiEnvElectronOptions
  | MultiEnvElectronOptions[]
  | Promise<MultiEnvElectronOptions | MultiEnvElectronOptions[]>

interface ResolvedElectronOptions {
  environmentOptions: Array<MultiEnvElectronOptions & { name: string }>
  defaultEnvs: Record<string, EnvironmentOptions>
}

export function electronPluginFactory(options: MultiEnvElectronOptionsFactory): Plugin[] {
  const resolveOptions = async (isDev: boolean, root: string): Promise<ResolvedElectronOptions> => {
    const context: ElectronFactoryContext = {
      root,
      packageJson: loadPackageJSONSync(root),
      isDev,
    }

    if (!context.packageJson) {
      throw new Error('[vite-plugin-electron] Cannot find package.json')
    }

    const rawOptions = await options(context)
    const envNames = new Set<string>()
    const environmentOptions = toArray(rawOptions).map((opt, i) => {
      const optionName = opt.name || i
      const name = `electron_${optionName}`
      if (envNames.has(name)) {
        throw new Error(
          `[vite-plugin-electron] Duplicate environment name "${optionName}". Please provide unique "name" properties for each environment in the options array.`,
        )
      }
      envNames.add(name)

      return Object.assign({}, opt, { name })
    })

    // Shared: create per-environment EnvironmentOptions from the options array.
    const defaultEnvs = Object.fromEntries<EnvironmentOptions>(
      environmentOptions.map((opt) => {
        const defaultConfig = createElectronViteDefaults(context.packageJson!.type === 'module', {
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

    return {
      environmentOptions,
      defaultEnvs,
    }
  }

  // Build each electron environment from the given builder in declaration order.
  const buildElectronEnvironments = async (
    builder: ViteBuilder,
    environmentOptions: ResolvedElectronOptions['environmentOptions'],
  ): Promise<void> => {
    for (const { name } of environmentOptions) {
      const env = builder.environments[name]
      if (env && !env.isBuilt) {
        await builder.build(env)
      }
    }
  }

  return createElectronPlugin({
    prefix: PLUGIN_PREFIX,
    async dev(pluginContext, server) {
      const { environmentOptions, defaultEnvs } = await resolveOptions(false, server.config.root)
      if (environmentOptions.length === 0) {
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
                  if (++builtCount < environmentOptions.length) {
                    return
                  }
                  triggerStartup(pluginContext, server, opt)
                },
              }
            })
          }),
        }),
      )

      await buildElectronEnvironments(builder, environmentOptions)
    },
    // Build is fully handled by the config() hook, so we can leave this empty.
    async build() {},
    // Use the config() hook to inject electron environments
    async buildConfig(config) {
      const { environmentOptions, defaultEnvs } = await resolveOptions(
        true,
        config.root || process.cwd(),
      )
      if (environmentOptions.length === 0) {
        return
      }

      // In build mode, all deps should be bundled.
      for (const envCfg of Object.values(defaultEnvs)) {
        envCfg.resolve ??= {}
        envCfg.resolve.noExternal ??= true
      }

      return withExternalBuiltins({
        environments: defaultEnvs,
        builder: {
          async buildApp(builder) {
            const prevBuildApp = config.builder?.buildApp
            if (prevBuildApp) {
              await prevBuildApp.call(this, builder)
            }

            const client = builder.environments.client
            if (client && !client.isBuilt) {
              await builder.build(client)
            }

            // Let the user's buildApp run first so the mock HTML remains available.
            await buildElectronEnvironments(builder, environmentOptions)
          },
        },
      })
    },
  })
}

export default function electron(
  options: MultiEnvElectronOptions | MultiEnvElectronOptions[],
): Plugin[] {
  return electronPluginFactory(() => options)
}
