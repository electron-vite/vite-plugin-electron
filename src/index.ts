import type { StdioOptions, SpawnOptions } from 'node:child_process'
import path from 'node:path'

import { build as viteBuild, createBuilder, perEnvironmentPlugin, version } from 'vite'
import type {
  ConfigEnv,
  EnvironmentOptions,
  InlineConfig,
  Plugin,
  PluginOption,
  UserConfig,
  ViteDevServer,
} from 'vite'

import {
  resolveServerUrl,
  resolveViteConfig,
  resolveViteEnvironmentConfig,
  resolveInput,
  setupMockHtml,
  withExternalBuiltins,
  treeKillSync,
} from './utils'

// public utils
export { resolveViteConfig, withExternalBuiltins }
export { loadPackageJSON, loadPackageJSONSync } from 'local-pkg'

export interface ElectronOnstartArgs {
  /**
   * Electron App startup function.
   * It will mount the Electron App child-process to `process.electronApp`.
   * @param argv default value `['.', '--no-sandbox']`
   * @param options options for `child_process.spawn`
   * @param customElectronPkg custom electron package name (default: 'electron')
   */
  startup: (
    argv?: string[],
    options?: import('node:child_process').SpawnOptions,
    customElectronPkg?: string,
  ) => Promise<void>
  /** Reload Electron-Renderer */
  reload: () => void
}

export type ElectronOnstart = (args: ElectronOnstartArgs) => void | Promise<void>

interface StartupFn {
  (argv?: string[], options?: SpawnOptions, customElectronPkg?: string): Promise<void>
  send: (message: string) => void
  hookedProcessExit: boolean
  exit: () => Promise<void>
}

/**
 * Electron App startup function.
 * It will mount the Electron App child-process to `process.electronApp`.
 * @param argv default value `['.', '--no-sandbox']`
 * @param options options for `child_process.spawn`
 * @param customElectronPkg custom electron package name (default: 'electron')
 */
export const startup: StartupFn = async (
  argv = ['.', '--no-sandbox'],
  options?: SpawnOptions,
  customElectronPkg?: string,
) => {
  const { spawn } = await import('node:child_process')
  const { createRequire } = await import('node:module')
  const electronPackage = customElectronPkg ?? 'electron'
  const roots = new Set<string>([
    process.cwd(),
    ...(typeof options?.cwd === 'string' ? [options.cwd] : []),
    ...(process.env.INIT_CWD ? [process.env.INIT_CWD] : []),
  ])

  let electron: any
  let resolutionError: unknown

  for (const root of roots) {
    try {
      const requireFromRoot = createRequire(path.join(root, 'package.json'))
      electron = requireFromRoot(electronPackage)
      break
    } catch (error) {
      resolutionError = error
    }
  }

  if (!electron) {
    try {
      electron = await import(electronPackage)
    } catch (error) {
      resolutionError = error
    }
  }

  if (!electron) {
    throw new Error(
      `Unable to resolve "${electronPackage}". Install it in the app project or pass startup(..., ..., customElectronPkg).`,
      { cause: resolutionError as Error },
    )
  }

  const electronPath = electron.default ?? electron

  await startup.exit()

  // Start Electron.app
  const stdio: StdioOptions =
    process.platform === 'linux'
      ? // reserve file descriptor 3 for Chromium; put Node IPC on file descriptor 4
        ['inherit', 'inherit', 'inherit', 'ignore', 'ipc']
      : ['inherit', 'inherit', 'inherit', 'ipc']
  process.electronApp = spawn(electronPath, argv, {
    stdio,
    ...options,
  })

  // Exit command after Electron.app exits
  process.electronApp.once('exit', process.exit)

  if (!startup.hookedProcessExit) {
    startup.hookedProcessExit = true
    process.once('exit', startup.exit)
  }
}

startup.send = (message: string) => {
  if (process.electronApp) {
    // Based on { stdio: [,,, 'ipc'] }
    process.electronApp.send?.(message)
  }
}

startup.hookedProcessExit = false
startup.exit = async () => {
  if (process.electronApp) {
    await new Promise((resolve) => {
      process.electronApp.removeAllListeners()

      if (process.electronApp.exitCode !== null) {
        resolve(undefined)
        return
      }
      process.electronApp.once('exit', resolve)

      try {
        treeKillSync(process.electronApp.pid!)
      } catch {
        // Windows: taskkill exit code 128 = process already gone
        resolve(undefined)
      }
    })
  }
}

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
  onstart?: ElectronOnstart
}

type ElectronFlatEnvironmentConfig = {
  /**
   * Shortcut of `options.build.lib.entry`
   */
  entry?: import('vite').LibraryOptions['entry']
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
  onstart?: ElectronOnstart
}

type ElectronFlatSharedConfig = Pick<InlineConfig, 'envDir' | 'envPrefix' | 'mode' | 'root'>

type ElectronFlatNormalizedOptions = {
  vite?: ElectronFlatSharedConfig
  environments: Record<string, ElectronFlatEnvironmentConfig>
}

type ElectronFlatEnvironmentContext = {
  entries: Array<[string, ElectronFlatEnvironmentConfig]>
  names: string[]
}

function resolveElectronEnvironmentBuildConfig(
  environment: ElectronFlatEnvironmentConfig,
  command: 'serve' | 'build',
): EnvironmentOptions {
  const config = resolveViteEnvironmentConfig(environment)

  if (command === 'serve') {
    config.build ??= {}
    if (!Object.keys(config.build).includes('watch')) {
      config.build.watch = {}
    }
    config.build.minify ??= false
  }

  return config
}

function createElectronEnvironmentScopedPlugins(
  environmentContext: ElectronFlatEnvironmentContext,
  pluginPrefix: string,
): PluginOption[] {
  return environmentContext.entries.map(([environmentName, environment]) => {
    if (!environment.plugins) {
      return undefined
    }

    return perEnvironmentPlugin(
      `${pluginPrefix}:plugins:${environmentName}`,
      (currentEnvironment) => {
        if (currentEnvironment.name !== environmentName) {
          return false
        }

        return environment.plugins
      },
    )
  })
}

function createElectronEnvironmentStartupPlugins(
  environmentContext: ElectronFlatEnvironmentContext,
  server: ViteDevServer,
  pluginPrefix: string,
): Plugin[] {
  const entryCount = environmentContext.names.length
  let closeBundleCount = 0
  const startupWithRoot = () => startup(['.', '--no-sandbox'], { cwd: server.config.root })

  return environmentContext.entries.map(([environmentName, environment]) => {
    return perEnvironmentPlugin(
      `${pluginPrefix}:startup:${environmentName}`,
      (currentEnvironment) => {
        if (currentEnvironment.name !== environmentName) {
          return false
        }

        return {
          name: `${pluginPrefix}:startup-hook:${environmentName}`,
          closeBundle() {
            if (++closeBundleCount < entryCount) {
              return
            }

            if (environment.onstart) {
              environment.onstart.call(this, {
                startup: startupWithRoot,
                reload() {
                  if (process.electronApp) {
                    ;(server.hot || server.ws).send({ type: 'full-reload' })
                    startup.send('electron-vite&type=hot-reload')
                  } else {
                    startupWithRoot()
                  }
                },
              })
            } else {
              startupWithRoot()
            }
          },
        }
      },
    )
  })
}

async function buildElectronWithEnvironmentApi(
  normalizedOptions: ElectronFlatNormalizedOptions,
  environmentContext: ElectronFlatEnvironmentContext,
  command: 'serve' | 'build',
  inheritedConfig: Pick<InlineConfig, 'envDir' | 'envPrefix' | 'mode' | 'root'>,
  pluginPrefix: string,
  startupPlugins: Plugin[] = [],
): Promise<void> {
  if (environmentContext.names.length === 0) {
    return
  }

  const builder = await createBuilder(
    withExternalBuiltins({
      configFile: false,
      publicDir: false,
      ...normalizedOptions.vite,
      ...inheritedConfig,
      builder: {
        async buildApp(builder) {
          for (const environmentName of environmentContext.names) {
            const environment = builder.environments[environmentName]
            if (!environment) {
              throw new Error(
                `[vite-plugin-electron] Unable to resolve build environment "${environmentName}".`,
              )
            }

            if (environment.isBuilt) {
              continue
            }

            await builder.build(environment)
          }
        },
      },
      environments: Object.fromEntries(
        environmentContext.entries.map(([environmentName, environment]) => [
          environmentName,
          resolveElectronEnvironmentBuildConfig(environment, command),
        ]),
      ),
      plugins: [
        ...createElectronEnvironmentScopedPlugins(environmentContext, pluginPrefix),
        ...startupPlugins,
      ],
    }),
  )

  await builder.buildApp()
}

export function build(options: ElectronOptions): ReturnType<typeof viteBuild> {
  return viteBuild(withExternalBuiltins(resolveViteConfig(options)))
}

const pluginPrefix = 'vite-plugin-electron'

export default function electron(options: ElectronOptions | ElectronOptions[]): Plugin[] {
  const optionsArray = Array.isArray(options) ? options : [options]
  let userConfig: UserConfig
  let configEnv: ConfigEnv
  let cleanupMock: (() => Promise<void>) | undefined

  if (Number.parseInt(version) < 8) {
    throw new Error(
      `[vite-plugin-electron] Vite v${version} does not support \`rolldownOptions\`, please install \`vite@>=8\` or use an earlier version of \`vite-plugin-electron\`.`,
    )
  }

  const areEnvPrefixesEqual = (
    left: ElectronFlatSharedConfig['envPrefix'],
    right: ElectronFlatSharedConfig['envPrefix'],
  ): boolean => {
    if (Array.isArray(left) || Array.isArray(right)) {
      return (
        Array.isArray(left) &&
        Array.isArray(right) &&
        left.length === right.length &&
        left.every((value, index) => value === right[index])
      )
    }

    return left === right
  }

  const resolveSharedFlatValue = <K extends keyof ElectronFlatSharedConfig>(
    key: K,
    isEqual: (
      left: Exclude<ElectronFlatSharedConfig[K], undefined>,
      right: Exclude<ElectronFlatSharedConfig[K], undefined>,
    ) => boolean = (left, right) => left === right,
  ): ElectronFlatSharedConfig[K] | undefined => {
    const values = optionsArray
      .map((entry) => entry.vite?.[key])
      .filter(
        (value): value is Exclude<ElectronFlatSharedConfig[K], undefined> => value !== undefined,
      )

    if (values.length === 0) {
      return undefined
    }

    const firstValue = values[0]!
    const restValues = values.slice(1)
    const hasConflict = restValues.some((value) => !isEqual(firstValue, value))

    if (hasConflict) {
      throw new Error(
        `[vite-plugin-electron] electron() requires all \`${key}\` values to match when building multiple Electron entries with Vite environments.`,
      )
    }

    return firstValue
  }

  const sharedConfig: ElectronFlatSharedConfig = {}

  const root = resolveSharedFlatValue('root')
  if (root !== undefined) {
    sharedConfig.root = root
  }

  const mode = resolveSharedFlatValue('mode')
  if (mode !== undefined) {
    sharedConfig.mode = mode
  }

  const envDir = resolveSharedFlatValue('envDir')
  if (envDir !== undefined) {
    sharedConfig.envDir = envDir
  }

  const envPrefix = resolveSharedFlatValue('envPrefix', areEnvPrefixesEqual)
  if (envPrefix !== undefined) {
    sharedConfig.envPrefix = envPrefix
  }

  const environments = new Map<string, ElectronFlatEnvironmentConfig>()

  for (const [index, optionsEntry] of optionsArray.entries()) {
    const environmentName = `electron_${optionsEntry.name ?? index}`
    if (environments.has(environmentName)) {
      throw new Error(
        `[vite-plugin-electron] Duplicate Electron environment name "${environmentName}".`,
      )
    }

    const { plugins, define, resolve, optimizeDeps, build } = optionsEntry.vite ?? {}
    const environmentOptions: EnvironmentOptions = {
      define,
      resolve,
      optimizeDeps,
      build,
    }
    const hasOptions = Object.values(environmentOptions).some((value) => value !== undefined)

    environments.set(environmentName, {
      entry: optionsEntry.entry,
      options: hasOptions ? environmentOptions : undefined,
      plugins,
      onstart: optionsEntry.onstart,
    })
  }

  const normalizedOptions: ElectronFlatNormalizedOptions = {
    vite: Object.keys(sharedConfig).length > 0 ? sharedConfig : undefined,
    environments: Object.fromEntries(environments),
  }

  const environmentEntries = Object.entries(normalizedOptions.environments) as Array<
    [string, ElectronFlatEnvironmentConfig]
  >
  const environmentContext: ElectronFlatEnvironmentContext = {
    entries: environmentEntries,
    names: environmentEntries.map(([environmentName]) => environmentName),
  }

  return [
    {
      name: `${pluginPrefix}:dev`,
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
          Object.assign(process.env, {
            VITE_DEV_SERVER_URL: resolveServerUrl(server),
          })

          await buildElectronWithEnvironmentApi(
            normalizedOptions,
            environmentContext,
            'serve',
            {
              mode: server.config.mode,
              root: server.config.root,
              envDir: server.config.envDir,
              envPrefix: server.config.envPrefix,
            },
            pluginPrefix,
            createElectronEnvironmentStartupPlugins(environmentContext, server, pluginPrefix),
          )
        })
      },
    },
    {
      name: `${pluginPrefix}:prod`,
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
        // Remove mock files created in configResolved before building Electron.
        if (cleanupMock) {
          await cleanupMock()
          cleanupMock = undefined
        }

        await buildElectronWithEnvironmentApi(
          normalizedOptions,
          environmentContext,
          'build',
          {
            mode: configEnv.mode,
            root: userConfig.root,
            envDir: userConfig.envDir,
            envPrefix: userConfig.envPrefix,
          },
          pluginPrefix,
        )
      },
    },
  ]
}
