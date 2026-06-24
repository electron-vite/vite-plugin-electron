import { loadPackageJSONSync } from 'local-pkg'
import { createBuilder, mergeConfig, perEnvironmentPlugin } from 'vite'
import type { EnvironmentOptions, Plugin, ViteBuilder } from 'vite'

import { createElectronPlugin } from './base'
import { extractExternalDeps } from './plugin/notBundle'
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

type EnvironmentResolveOptions = NonNullable<EnvironmentOptions['resolve']>

export type BundleDepsExclude = EnvironmentResolveOptions['external']
export type BundleDepsInclude = EnvironmentResolveOptions['noExternal']

export interface BundleDepsModeOptions {
  /** Dependencies to include in the bundle. Maps to `resolve.noExternal`. */
  include?: BundleDepsInclude
  /** Dependencies to exclude from the bundle. Maps to `resolve.external`. */
  exclude?: BundleDepsExclude
}

export interface BundleDepsOptions {
  /** Policy shared by development and production builds. */
  both?: BundleDepsModeOptions
  /** Policy applied only while serving. */
  dev?: BundleDepsModeOptions
  /** Policy applied only while building. */
  build?: BundleDepsModeOptions
}

export type BundleDeps = 'vite' | 'auto' | boolean | BundleDepsOptions

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
  /**
   * Controls how dependencies are bundled.
   *
   * - `'vite'` (default) keeps Vite's server-environment behavior.
   * - `'auto'` bundles all dependencies except the package.json dependencies
   *   selected by the standalone `notBundle()` plugin.
   * - `true` bundles all dependencies.
   * - `false` externalizes all dependencies.
   * - An object configures mode-specific policies. `exclude` maps to
   *   `resolve.external`, while `include` maps to `resolve.noExternal`.
   *
   * @default 'vite'
   */
  bundleDeps?: BundleDeps
}

export interface MultiEnvElectronOptionsRecord {
  main: Omit<MultiEnvElectronOptions, 'name'>
  preload?: Omit<MultiEnvElectronOptions, 'name'>
}

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

function resolveBundleDepsConfig(
  context: ElectronFactoryContext,
  bundleDeps: BundleDeps,
): EnvironmentOptions {
  if (typeof bundleDeps === 'object') {
    const mode = context.isDev ? 'dev' : 'build'
    return mergeConfig<EnvironmentOptions, EnvironmentOptions>(
      {
        resolve: {
          external: bundleDeps.both?.exclude,
          noExternal: bundleDeps.both?.include,
        },
      },
      {
        resolve: {
          external: bundleDeps[mode]?.exclude,
          noExternal: bundleDeps[mode]?.include,
        },
      },
    )
  }

  switch (bundleDeps) {
    case 'auto':
      return {
        resolve: {
          external: extractExternalDeps(context.packageJson!, context.isDev) as BundleDepsExclude,
          noExternal: true,
        },
      }
    case true:
      return { resolve: { noExternal: true } }
    case false:
      return { resolve: { external: true } }
    default:
      return {}
  }
}

function resolveEnvironmentConfig(
  context: ElectronFactoryContext,
  opt: MultiEnvElectronOptions & { name: string },
): EnvironmentOptions {
  const defaultConfig = createElectronViteDefaults(context.packageJson!.type === 'module', {
    input: opt.input,
    plugins: opt.plugins,
  })

  const dependencyConfig = resolveBundleDepsConfig(context, opt.bundleDeps ?? 'vite')

  const resolvedConfig: EnvironmentOptions = mergeConfig<EnvironmentOptions, EnvironmentOptions>(
    mergeConfig<EnvironmentOptions, EnvironmentOptions>(
      { consumer: 'server', ...defaultConfig },
      dependencyConfig,
    ),
    opt.options ?? {},
  )

  return resolvedConfig
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
        return [opt.name, resolveEnvironmentConfig(context, opt)]
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
      const { environmentOptions, defaultEnvs } = await resolveOptions(true, server.config.root)
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
        false,
        config.root || process.cwd(),
      )
      if (environmentOptions.length === 0) {
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
