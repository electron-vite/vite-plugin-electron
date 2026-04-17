import type { StdioOptions, SpawnOptions } from 'node:child_process'
import path from 'node:path'

import { build as viteBuild, version } from 'vite'
import type { EnvironmentOptions, Plugin, PluginOption, ResolvedConfig } from 'vite'

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

const electronEnvironmentNamePrefix = 'vite_plugin_electron_'
const internalPluginNamePrefix = 'vite-plugin-electron:'

function resolveElectronEnvironmentName(index: number) {
  return `${electronEnvironmentNamePrefix}${index}`
}

function resolveElectronEnvironmentConfig(options: ElectronOptions): EnvironmentOptions {
  const {
    build,
    define,
    keepProcessEnv,
    optimizeDeps,
    resolve,
  } = withExternalBuiltins(resolveViteConfig(options))

  return {
    consumer: 'server',
    build,
    define,
    keepProcessEnv,
    optimizeDeps,
    resolve,
  }
}

function electronEnvironmentPlugin(name: string, plugins: PluginOption[] | undefined): Plugin {
  return {
    name: `${internalPluginNamePrefix}${name}:plugins`,
    apply: 'build',
    sharedDuringBuild: true,
    applyToEnvironment(environment) {
      return environment.name === name && plugins?.length ? plugins : false
    },
  }
}

export function build(options: ElectronOptions): ReturnType<typeof viteBuild> {
  return viteBuild(withExternalBuiltins(resolveViteConfig(options)))
}

export default function electron(options: ElectronOptions | ElectronOptions[]): Plugin[] {
  const optionsArray = Array.isArray(options) ? options : [options]
  const electronEnvironments = optionsArray.map((options, index) => ({
    name: resolveElectronEnvironmentName(index),
    options,
  }))
  const electronEnvironmentNames = new Set(electronEnvironments.map(({ name }) => name))
  let cleanupMock: (() => Promise<void>) | undefined
  let resolvedConfig: ResolvedConfig | undefined
  let usingEnvironmentBuildApp = false

  if (!version.startsWith('8.')) {
    throw new Error(
      `[vite-plugin-electron] Vite v${version} does not support \`rolldownOptions\`, please install \`vite@>=8\` or use an earlier version of \`vite-plugin-electron\`.`,
    )
  }

  return [
    ...electronEnvironments.map(({ name, options }) =>
      electronEnvironmentPlugin(name, options.vite?.plugins),
    ),
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

          const entryCount = optionsArray.length
          let closeBundleCount = 0

          for (const options of optionsArray) {
            options.vite ??= {}
            options.vite.mode ??= server.config.mode
            options.vite.root ??= server.config.root
            options.vite.envDir ??= server.config.envDir
            options.vite.envPrefix ??= server.config.envPrefix

            options.vite.build ??= {}
            if (!Object.keys(options.vite.build).includes('watch')) {
              // #252
              options.vite.build.watch = {}
            }
            options.vite.build.minify ??= false

            options.vite.plugins ??= []
            options.vite.plugins.push({
              name: ':startup',
              closeBundle() {
                if (++closeBundleCount < entryCount) {
                  return
                }

                if (options.onstart) {
                  options.onstart.call(this, {
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
                  startup()
                }
              },
            })
            build(options)
          }
        })
      },
    },
    {
      name: 'vite-plugin-electron:prod',
      apply: 'build',
      sharedDuringBuild: true,
      config(config) {
        // Make sure that Electron can be loaded into the local file using `loadFile` after packaging.
        config.base ??= './'
        config.builder ??= {}
        config.environments ??= {}

        for (const { name, options } of electronEnvironments) {
          config.environments[name] = resolveElectronEnvironmentConfig(options)
        }
      },
      configResolved(config) {
        resolvedConfig = config

        for (let index = 0; index < config.plugins.length; index++) {
          const plugin = config.plugins[index]

          if (
            plugin.name.startsWith('vite:') ||
            plugin.name.startsWith('native:') ||
            plugin.name.startsWith('builtin:') ||
            plugin.name.startsWith(internalPluginNamePrefix)
          ) {
            continue
          }

          const applyToEnvironment = plugin.applyToEnvironment
          if (!applyToEnvironment) {
            continue
          }

          config.plugins[index] = Object.assign(
            Object.create(Object.getPrototypeOf(plugin)),
            plugin,
            {
              applyToEnvironment: async (environment) => {
                if (electronEnvironmentNames.has(environment.name)) {
                  return false
                }
                return await applyToEnvironment(environment)
              },
            },
          )
        }

        // When there is no entry (no index.html and no configured input), write a
        // temporary mock so that Vite's build has a valid entry point.
        if (!resolveInput(config)) {
          cleanupMock = setupMockHtml(config, true, config.logger)
        }
      },
      async closeBundle() {
        if (usingEnvironmentBuildApp) {
          return
        }

        // Remove mock files created in configResolved before building Electron.
        if (cleanupMock) {
          await cleanupMock()
          cleanupMock = undefined
        }

        if (!resolvedConfig) {
          return
        }

        for (const options of optionsArray) {
          options.vite ??= {}
          options.vite.mode ??= resolvedConfig.mode
          options.vite.root ??= resolvedConfig.root
          options.vite.envDir ??= resolvedConfig.envDir
          options.vite.envPrefix ??= resolvedConfig.envPrefix
          await build(options)
        }
      },
    },
    {
      name: 'vite-plugin-electron:build-app',
      apply: 'build',
      sharedDuringBuild: true,
      buildApp() {
        usingEnvironmentBuildApp = true
      },
    },
    {
      name: 'vite-plugin-electron:build-app-cleanup',
      apply: 'build',
      sharedDuringBuild: true,
      buildApp: {
        order: 'post',
        async handler() {
          if (cleanupMock) {
            await cleanupMock()
            cleanupMock = undefined
          }
        },
      },
    },
  ]
}
