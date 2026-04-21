import type { StdioOptions, SpawnOptions } from 'node:child_process'
import path from 'node:path'

import { build as viteBuild, createBuilder, perEnvironmentPlugin, version } from 'vite'
import type { EnvironmentOptions, InlineConfig, Plugin, UserConfig, ViteDevServer } from 'vite'

import {
  resolveServerUrl,
  resolveViteConfig,
  resolveInput,
  setupMockHtml,
  withExternalBuiltins,
  treeKillSync,
} from './utils'

// public utils
export { resolveViteConfig, withExternalBuiltins }
export { loadPackageJSON, loadPackageJSONSync } from 'local-pkg'
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
  // Based on { stdio: [,,, 'ipc'] }
  process.electronApp?.send?.(message)
}

startup.hookedProcessExit = false
startup.exit = async () => {
  if (process.electronApp) {
    await new Promise((resolve) => {
      process.electronApp.removeAllListeners()
      process.electronApp.once('exit', resolve)
      treeKillSync(process.electronApp.pid!)
    })
  }
}

export interface ElectronOptions {
  /**
   * Optional name for the Electron environment.
   *
   * By default, the plugin will generate environment names like `electron_0`, `electron_1`, etc. based on the order of the options provided.
   * You can specify a custom name for each environment using this `name` property, which will be used in the Vite environment configuration and plugin application.
   *
   * For example, if you have two Electron environments and you set `name: 'main'` for the first one and `name: 'preload'` for the second one, the plugin will create environments named `electron_main` and `electron_preload` instead of `electron_0` and `electron_1`.
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
  }) => void | Promise<void>
}

interface BuildDefaults {
  mode?: string
  root?: string
  envDir?: string | false
  envPrefix?: string | string[]
}

type StartupPluginContext = ThisParameterType<NonNullable<Plugin['closeBundle']>>

const ELECTRON_ENV_PREFIX = 'electron'

function resolveEnvironmentName(indexOrName: number | string) {
  return `${ELECTRON_ENV_PREFIX}_${indexOrName}`
}

interface ElectronEnvironmentEntry {
  name: string
  config: InlineConfig
}

function collectElectronEnvironmentEntries(
  optionsArray: ElectronOptions[],
  defaults: BuildDefaults = {},
): ElectronEnvironmentEntry[] {
  return optionsArray.map((options, index) => {
    const resolvedOptions = {
      ...options,
      vite: {
        ...options.vite,
        mode: options.vite?.mode ?? defaults.mode,
        root: options.vite?.root ?? defaults.root,
        envDir:
          typeof defaults.envDir === 'string'
            ? (options.vite?.envDir ?? defaults.envDir)
            : options.vite?.envDir,
        envPrefix: options.vite?.envPrefix ?? defaults.envPrefix,
      },
    }

    return {
      name: resolveEnvironmentName(options.name ?? index),
      config: withExternalBuiltins(resolveViteConfig(resolvedOptions)),
    }
  })
}

function createPerEnvironmentPlugins(entries: readonly ElectronEnvironmentEntry[]): Plugin[] {
  return entries.flatMap(({ name, config }) =>
    (config.plugins ?? []).map((plugin, pluginIndex) =>
      perEnvironmentPlugin(`${name}:${pluginIndex}`, (environment) =>
        environment.name === name ? plugin : false,
      ),
    ),
  )
}

interface ElectronConfigSetup {
  entries: ElectronEnvironmentEntry[]
  sharedConfig: UserConfig
}

function createElectronConfigSetup(
  optionsArray: ElectronOptions[],
  defaults: BuildDefaults = {},
): ElectronConfigSetup {
  const entries = collectElectronEnvironmentEntries(optionsArray, defaults)

  return {
    entries,
    sharedConfig: {
      mode: defaults.mode,
      root: defaults.root,
      envDir: typeof defaults.envDir === 'string' ? defaults.envDir : undefined,
      envPrefix: defaults.envPrefix,
      environments: Object.fromEntries(
        entries.map(({ name, config }) => [
          name,
          {
            consumer: 'server',
            build: config.build,
            define: config.define,
            resolve: config.resolve,
            optimizeDeps: config.optimizeDeps,
          } satisfies EnvironmentOptions,
        ]),
      ),
    },
  }
}

function createDevConfig(
  optionsArray: ElectronOptions[],
  defaults: BuildDefaults,
  startupPlugin?: Plugin,
): InlineConfig {
  const { entries, sharedConfig } = createElectronConfigSetup(optionsArray, defaults)

  for (const entry of entries) {
    entry.config.build = {
      ...entry.config.build,
      watch: entry.config.build?.watch ?? {},
      minify: entry.config.build?.minify ?? false,
    }
  }

  const plugins = createPerEnvironmentPlugins(entries)
  if (startupPlugin) {
    plugins.push(startupPlugin)
  }

  return {
    ...sharedConfig,
    configFile: false,
    publicDir: false,
    plugins,
  }
}

function createBuildConfig(
  optionsArray: ElectronOptions[],
  defaults: BuildDefaults,
  userConfig: UserConfig,
): UserConfig {
  const { sharedConfig } = createElectronConfigSetup(optionsArray, defaults)

  return {
    ...sharedConfig,
    builder: {
      ...userConfig.builder,
      async buildApp(builder) {
        for (const environment of Object.values(builder.environments)) {
          await builder.build(environment)
        }

        await userConfig.builder?.buildApp?.call(this, builder)
      },
    },
  }
}

interface ElectronDevRuntimeConfig {
  defaultArgs: string[]
  onstart?: ElectronOptions['onstart']
}

function createStartupHook(server: ViteDevServer, optionsArray: ElectronOptions[]): Plugin {
  const environmentConfigs = new Map<string, ElectronDevRuntimeConfig>(
    optionsArray.map((options, index) => [
      resolveEnvironmentName(options.name ?? index),
      {
        defaultArgs: [options.vite?.root || server.config.root, '--no-sandbox'],
        onstart: options.onstart,
      },
    ]),
  )

  let initialPendingBuildCount = environmentConfigs.size
  const startupEnvironmentName = resolveEnvironmentName(
    optionsArray[optionsArray.length - 1]!.name ?? optionsArray.length - 1,
  )
  const runningBuilds = new Set<string>()
  const changedEnvironments = new Set<string>()
  let hasFailedWatchBuild = false
  let onstartQueue = Promise.resolve()

  const enqueueOnstart = (pluginContext: StartupPluginContext, environmentName: string) => {
    onstartQueue = onstartQueue
      .catch(() => {})
      .then(async () => {
        const targetConfig = environmentConfigs.get(environmentName)
        if (!targetConfig) {
          return
        }

        if (targetConfig.onstart) {
          await targetConfig.onstart.call(pluginContext, {
            async startup(
              args = targetConfig.defaultArgs,
              options?: SpawnOptions,
              customElectronPkg?: string,
            ) {
              await startup(args, options, customElectronPkg)
            },
            // Why not use Vite's built-in `/@vite/client` to implement Hot reload?
            // Because Vite only inserts `/@vite/client` into the `*.html` entry file, the preload scripts are usually a `*.js` file.
            // @see - https://github.com/vitejs/vite/blob/v5.2.11/packages/vite/src/node/server/middlewares/indexHtml.ts#L399
            reload() {
              if (process.electronApp) {
                ;(server.hot || server.ws).send({ type: 'full-reload' })

                // For Electron apps that don't need to use the renderer process.
                startup.send('electron-vite&type=hot-reload')
              } else {
                void startup(targetConfig.defaultArgs)
              }
            },
          })
        } else {
          await startup(targetConfig.defaultArgs)
        }
      })
      .catch((error) => {
        server.config.logger.error(
          `[vite-plugin-electron] Failed to run Electron dev onstart: ${error}`,
          { timestamp: true },
        )
      })
  }

  return {
    name: 'vite-plugin-electron:startup',
    applyToEnvironment(environment) {
      return environmentConfigs.has(environment.name)
    },
    buildStart() {
      runningBuilds.add(this.environment.name)
      if (initialPendingBuildCount === 0) {
        changedEnvironments.add(this.environment.name)
      }
    },
    buildEnd(error) {
      if (initialPendingBuildCount === 0) {
        runningBuilds.delete(this.environment.name)
        if (error) {
          hasFailedWatchBuild = true
          changedEnvironments.delete(this.environment.name)
        }
      }
    },
    async closeBundle() {
      runningBuilds.delete(this.environment.name)
      if (initialPendingBuildCount > 0) {
        initialPendingBuildCount -= 1
        if (initialPendingBuildCount > 0) {
          return
        }

        enqueueOnstart(this, startupEnvironmentName)
        return
      }

      if (runningBuilds.size > 0) {
        return
      }

      if (hasFailedWatchBuild) {
        hasFailedWatchBuild = false
        changedEnvironments.clear()
        return
      }

      const targetEnvironmentName = changedEnvironments.has(startupEnvironmentName)
        ? startupEnvironmentName
        : [...environmentConfigs.keys()].find((environmentName) =>
            changedEnvironments.has(environmentName),
          )
      changedEnvironments.clear()

      if (targetEnvironmentName) {
        enqueueOnstart(this, targetEnvironmentName)
      }
    },
  }
}

export function build(options: ElectronOptions): ReturnType<typeof viteBuild> {
  return viteBuild(withExternalBuiltins(resolveViteConfig(options)))
}

export default function electron(options: ElectronOptions | ElectronOptions[]): Plugin[] {
  const optionsArray = Array.isArray(options) ? options : [options]
  let cleanupMock: (() => Promise<void>) | undefined

  const clearCleanupMock = async () => {
    if (!cleanupMock) {
      return
    }

    try {
      await cleanupMock()
    } finally {
      cleanupMock = undefined
    }
  }

  if (Number.parseInt(version) < 8) {
    throw new Error(
      `[vite-plugin-electron] Vite v${version} does not support \`rolldownOptions\`, please install \`vite@>=8\` or use an earlier version of \`vite-plugin-electron\`.`,
    )
  }

  const perEnvPlugins = optionsArray.flatMap((opt, idx) =>
    (opt.vite?.plugins || []).map((plugin, pluginIndex) => {
      const name = resolveEnvironmentName(idx)
      return perEnvironmentPlugin(`${name}:${pluginIndex}`, (environment) =>
        environment.name === name ? plugin : false,
      )
    }),
  )

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
        server.httpServer?.once('close', clearCleanupMock)

        server.httpServer?.once('listening', () => {
          Object.assign(process.env, {
            VITE_DEV_SERVER_URL: resolveServerUrl(server),
          })

          if (optionsArray.length === 0) {
            return
          }

          const startupHook = createStartupHook(server, optionsArray)

          void createBuilder(
            createDevConfig(
              optionsArray,
              {
                mode: server.config.mode,
                root: server.config.root,
                envDir: server.config.envDir,
                envPrefix: server.config.envPrefix,
              },
              startupHook,
            ),
          )
            .then((builder) => builder.buildApp())
            .catch((error) => {
              server.config.logger.error(
                `[vite-plugin-electron] Failed to start Electron dev build: ${error}`,
                { timestamp: true },
              )
            })
        })
      },
    },
    ...perEnvPlugins,
    {
      name: 'vite-plugin-electron:prod',
      apply: 'build',
      config(config, env) {
        // Make sure that Electron can be loaded into the local file using `loadFile` after packaging.
        config.base ??= './'

        if (optionsArray.length === 0) {
          return
        }

        return createBuildConfig(
          optionsArray,
          {
            mode: env.mode,
            root: config.root,
            envDir: config.envDir,
            envPrefix: config.envPrefix,
          },
          config,
        )
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
        await clearCleanupMock()
      },
    },
  ]
}
