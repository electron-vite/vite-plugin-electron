import type { StdioOptions, SpawnOptions } from 'node:child_process'
import path from 'node:path'

import { build as viteBuild, perEnvironmentPlugin, version } from 'vite'
import type { EnvironmentOptions, InlineConfig, Plugin, PluginOption, UserConfig } from 'vite'

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
  (): Promise<void>
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
      process.electronApp.once('exit', resolve)
      treeKillSync(process.electronApp.pid!)
    })
  }
}

export interface ElectronOptions {
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

type BuildAppHook = NonNullable<InlineConfig['builder']>['buildApp']

const ELECTRON_ENV_PREFIX = 'vite-plugin-electron:electron'

function resolveEnvironmentName(index: number) {
  return `${ELECTRON_ENV_PREFIX}-${index}`
}

function flattenPlugins(plugins: PluginOption): Plugin[] {
  if (!plugins) {
    return []
  }

  if (Array.isArray(plugins)) {
    return plugins.flatMap((plugin) => flattenPlugins(plugin))
  }

  if (typeof (plugins as Promise<unknown>)?.then === 'function') {
    throw new TypeError(
      '[vite-plugin-electron] Async plugin factories are not supported in `options.vite.plugins`.',
    )
  }

  return [plugins as Plugin]
}

interface ElectronEnvironmentEntry {
  name: string
  config: InlineConfig
}

function applyBuildDefaults(options: ElectronOptions, defaults: BuildDefaults) {
  options.vite ??= {}
  options.vite.mode ??= defaults.mode
  options.vite.root ??= defaults.root
  if (typeof defaults.envDir === 'string') {
    options.vite.envDir ??= defaults.envDir
  }
  options.vite.envPrefix ??= defaults.envPrefix
}

function collectElectronEnvironmentEntries(
  optionsArray: ElectronOptions[],
  defaults: BuildDefaults,
): ElectronEnvironmentEntry[] {
  return optionsArray.map((options, index) => {
    applyBuildDefaults(options, defaults)

    return {
      name: resolveEnvironmentName(index),
      config: withExternalBuiltins(resolveViteConfig(options)),
    }
  })
}

function createEnvironmentOptionsMap(entries: ElectronEnvironmentEntry[]) {
  return Object.fromEntries(
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
  )
}

function createPerEnvironmentPlugins(entries: ElectronEnvironmentEntry[]): Plugin[] {
  const plugins: Plugin[] = []

  entries.forEach(({ name, config }) => {
    const scopedPlugins = flattenPlugins(config.plugins ?? [])

    scopedPlugins.forEach((plugin, pluginIndex) => {
      plugins.push(
        perEnvironmentPlugin(`${plugin.name || 'plugin'}:${name}:${pluginIndex}`, (environment) =>
          environment.name === name ? plugin : false,
        ),
      )
    })
  })

  return plugins
}

function createDevBuildConfig(
  optionsArray: ElectronOptions[],
  defaults: BuildDefaults,
  startupPlugin?: Plugin,
): InlineConfig {
  const envDir = typeof defaults.envDir === 'string' ? defaults.envDir : undefined
  const entries = collectElectronEnvironmentEntries(optionsArray, defaults)
  const plugins = createPerEnvironmentPlugins(entries)

  if (startupPlugin) {
    plugins.push(startupPlugin)
  }

  return {
    configFile: false,
    publicDir: false,
    mode: defaults.mode,
    root: defaults.root,
    envDir,
    envPrefix: defaults.envPrefix,
    environments: createEnvironmentOptionsMap(entries),
    builder: {
      async buildApp(builder) {
        const environments = Object.entries(builder.environments)
        for (const [name, environment] of environments) {
          if (name.startsWith(ELECTRON_ENV_PREFIX)) {
            await builder.build(environment)
          }
        }
      },
    },
    plugins,
  }
}

function resolveBuildAppHook(userBuildApp?: BuildAppHook): BuildAppHook {
  return async function (this: ThisParameterType<BuildAppHook>, builder) {
    const built = new Set<string>()
    const originalBuild = builder.build.bind(builder)

    builder.build = async (environment) => {
      built.add(environment.name)
      return originalBuild(environment)
    }

    try {
      if (userBuildApp) {
        await userBuildApp.call(this, builder)
      } else {
        for (const environment of Object.values(builder.environments)) {
          await builder.build(environment)
        }
      }
    } finally {
      builder.build = originalBuild
    }

    for (const [name, environment] of Object.entries(builder.environments)) {
      if (name.startsWith(ELECTRON_ENV_PREFIX) && !built.has(name)) {
        await originalBuild(environment)
      }
    }
  }
}

function createBuildModeConfig(
  optionsArray: ElectronOptions[],
  defaults: BuildDefaults,
  userConfig: UserConfig,
) {
  const envDir = typeof defaults.envDir === 'string' ? defaults.envDir : undefined
  const entries = collectElectronEnvironmentEntries(optionsArray, defaults)

  return {
    environments: createEnvironmentOptionsMap(entries),
    builder: {
      ...userConfig.builder,
      buildApp: resolveBuildAppHook(userConfig.builder?.buildApp),
    },
    envDir,
    envPrefix: defaults.envPrefix,
    mode: defaults.mode,
    root: defaults.root,
  }
}

function createEnvironmentPlugins(optionsArray: ElectronOptions[]): Plugin[] {
  return createPerEnvironmentPlugins(collectElectronEnvironmentEntries(optionsArray, {}))
}

export function build(options: ElectronOptions): ReturnType<typeof viteBuild> {
  return viteBuild(withExternalBuiltins(resolveViteConfig(options)))
}

export default function electron(options: ElectronOptions | ElectronOptions[]): Plugin[] {
  const optionsArray = Array.isArray(options) ? options : [options]
  const environmentPlugins = createEnvironmentPlugins(optionsArray)
  let cleanupMock: (() => Promise<void>) | undefined

  if (!version.startsWith('8.')) {
    throw new Error(
      `[vite-plugin-electron] Vite v${version} does not support \`rolldownOptions\`, please install \`vite@>=8\` or use an earlier version of \`vite-plugin-electron\`.`,
    )
  }

  return [
    ...environmentPlugins,
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
        server.httpServer?.once('close', async () => {
          if (cleanupMock) {
            await cleanupMock()
            cleanupMock = undefined
          }
        })

        server.httpServer?.once('listening', () => {
          Object.assign(process.env, {
            VITE_DEV_SERVER_URL: resolveServerUrl(server),
          })

          if (optionsArray.length === 0) {
            return
          }

          const pending = new Set(optionsArray.map((_, index) => resolveEnvironmentName(index)))
          const startupOption = optionsArray[optionsArray.length - 1]!

          optionsArray.forEach((options) => {
            options.vite ??= {}
            options.vite.build ??= {}
            if (!Object.keys(options.vite.build).includes('watch')) {
              // #252
              options.vite.build.watch = {}
            }
            options.vite.build.minify ??= false
          })

          const startupHook: Plugin = {
            name: 'vite-plugin-electron:startup',
            applyToEnvironment(environment) {
              return pending.has(environment.name)
            },
            async closeBundle() {
              if (!pending.has(this.environment.name)) {
                return
              }

              pending.delete(this.environment.name)
              if (pending.size > 0) {
                return
              }

              for (let i = 0; i < optionsArray.length; i++) {
                pending.add(resolveEnvironmentName(i))
              }

              if (startupOption.onstart) {
                await startupOption.onstart.call(this, {
                  startup,
                  // Why not use Vite's built-in `/@vite/client` to implement Hot reload?
                  // Because Vite only inserts `/@vite/client` into the `*.html` entry file, the preload scripts are usually a `*.js` file.
                  // @see - https://github.com/vitejs/vite/blob/v5.2.11/packages/vite/src/node/server/middlewares/indexHtml.ts#L399
                  reload() {
                    if (process.electronApp) {
                      ;(server.hot || server.ws).send({ type: 'full-reload' })

                      // For Electron apps that don't need to use the renderer process.
                      startup.send('electron-vite&type=hot-reload')
                    } else {
                      startup()
                    }
                  },
                })
              } else {
                await startup()
              }
            },
          }

          void viteBuild(
            createDevBuildConfig(
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
        })
      },
    },
    {
      name: 'vite-plugin-electron:prod',
      apply: 'build',
      config(config, env) {
        // Make sure that Electron can be loaded into the local file using `loadFile` after packaging.
        config.base ??= './'

        if (optionsArray.length === 0) {
          return
        }

        return createBuildModeConfig(
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
        if (cleanupMock) {
          await cleanupMock()
          cleanupMock = undefined
        }
      },
    },
  ]
}
