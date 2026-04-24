import type { StdioOptions, SpawnOptions } from 'node:child_process'
import path from 'node:path'

import { build as viteBuild, version } from 'vite'
import type { Plugin, ConfigEnv, UserConfig } from 'vite'

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
  (
    argv?: string[],
    options?: import('node:child_process').SpawnOptions,
    customElectronPkg?: string,
  ): Promise<void>
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

                const startupWithRoot = (
                  argv?: string[],
                  spawnOptions?: import('node:child_process').SpawnOptions,
                  customElectronPkg?: string,
                ) => {
                  return startup(
                    argv,
                    { cwd: server.config.root, ...spawnOptions },
                    customElectronPkg,
                  )
                }
                if (options.onstart) {
                  options.onstart.call(this, {
                    startup: startupWithRoot,
                    // Why not use Vite's built-in `/@vite/client` to implement Hot reload?
                    // Because Vite only inserts `/@vite/client` into the `*.html` entry file, the preload scripts are usually a `*.js` file.
                    // @see - https://github.com/vitejs/vite/blob/v5.2.11/packages/vite/src/node/server/middlewares/indexHtml.ts#L399
                    reload() {
                      if (process.electronApp) {
                        ;(server.hot || server.ws).send({ type: 'full-reload' })

                        // For Electron apps that don't need to use the renderer process.
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
            })
            build(options)
          }
        })
      },
    },
    {
      name: 'vite-plugin-electron:prod',
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
        for (const options of optionsArray) {
          options.vite ??= {}
          options.vite.mode ??= configEnv.mode
          options.vite.root ??= userConfig.root
          options.vite.envDir ??= userConfig.envDir
          options.vite.envPrefix ??= userConfig.envPrefix
          await build(options)
        }

        // Remove mock files created in configResolved before building Electron.
        if (cleanupMock) {
          await cleanupMock()
          cleanupMock = undefined
        }
      },
    },
  ]
}
