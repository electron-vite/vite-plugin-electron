import type { ChildProcess, SpawnOptions, StdioOptions } from 'node:child_process'
import path from 'node:path'

import type { ViteDevServer } from 'vite'

import type { ConfigServerContext } from './base'

const startupEnv = {
  REMOTE_DEBUGGING_PORT: '--remote-debugging-port',
  ELECTRON_IGNORE_CERTIFICATE_ERRORS: '--ignore-certificate-errors',
  ELECTRON_DISABLE_WEB_SECURITY: '--disable-web-security',
  ELECTRON_INSPECT: '--inspect',
  ELECTRON_INSPECT_BRK: '--inspect-brk',
} as const

function parseEnvVar(value: string | undefined): boolean | string {
  if (value === 'true' || value === '1') {
    return true
  }
  if (value === 'false' || value === '0' || value === '' || value === undefined) {
    return false
  }
  return value
}

type ElectronExitHandler = (code: number | null, signal: NodeJS.Signals | null) => void
type KillSignal = NonNullable<SpawnOptions['killSignal']>

const electronExitHandlers = new WeakMap<ChildProcess, ElectronExitHandler>()
const electronKillSignals = new WeakMap<ChildProcess, KillSignal>()
const electronExitPromises = new WeakMap<ChildProcess, Promise<void>>()

function bindElectronExit(electronApp: ChildProcess, onExit: ElectronExitHandler): void {
  const handler: ElectronExitHandler = (code, signal) => {
    electronExitHandlers.delete(electronApp)
    electronKillSignals.delete(electronApp)

    if (process.electronApp === electronApp) {
      process.electronApp = undefined
    }

    onExit(code, signal)
  }

  electronExitHandlers.set(electronApp, handler)
  electronApp.once('exit', handler)
}

function unbindElectronExit(electronApp: ChildProcess): void {
  const handler = electronExitHandlers.get(electronApp)
  if (!handler) {
    return
  }

  electronApp.removeListener('exit', handler)
  electronExitHandlers.delete(electronApp)
}

interface StartupFn {
  (
    argv?: string[],
    options?: import('node:child_process').SpawnOptions,
    customElectronPkg?: string,
  ): Promise<boolean>
  send: (message: string) => void
  /**
   * If `prevent` is set to `true`, the startup function will not start the Electron app, and you can control when to start it by calling the `startup` function. This is useful when you want to do some preparation work before starting the Electron app, such as waiting for a server to be ready.
   */
  prevent: boolean
  /**
   * @deprecated No use
   */
  hookedProcessExit: boolean
  /**
   * Stop the current Electron app and resolve after its child process closes.
   * @param signal overrides the spawn killSignal for this shutdown
   */
  exit: (signal?: KillSignal) => Promise<void>
}

/**
 * Electron App startup function.
 * It will mount the Electron App child-process to `process.electronApp`.
 *
 * You can also set environment variables to control the Electron CLI flags.
 * `1` or `true` turns a flag on, `0` or `false` turns it off, and any other non-empty
 * value is appended as `=<value>`.
 *
 * Supported env vars:
 * - `REMOTE_DEBUGGING_PORT` appends `--remote-debugging-port=<value>`
 * - `ELECTRON_IGNORE_CERTIFICATE_ERRORS` appends `--ignore-certificate-errors`
 * - `ELECTRON_DISABLE_WEB_SECURITY` appends `--disable-web-security`
 * - `ELECTRON_INSPECT` appends `--inspect` or `--inspect=<value>`
 * - `ELECTRON_INSPECT_BRK` appends `--inspect-brk` or `--inspect-brk=<value>`
 * @param argv default value `['.', '--no-sandbox']`
 * @param options options for `child_process.spawn`
 * @param customElectronPkg custom electron package name (default: 'electron')
 * @returns `true` if the Electron app is started, or `false` if the startup is prevented by `startup.prevent` or `ELECTRON_STARTUP_PREVENT` env var.
 */
async function startElectron(
  argv = ['.', '--no-sandbox'],
  options?: SpawnOptions,
  customElectronPkg?: string,
  onExit: ElectronExitHandler = (code) => process.exit(code ?? 0),
): Promise<boolean> {
  if (startup.prevent || parseEnvVar(process.env.ELECTRON_STARTUP_PREVENT?.trim())) {
    process.electronApp = undefined
    return false
  }
  const { spawn } = await import('node:child_process')
  const { createRequire } = await import('node:module')
  const electronPackage = customElectronPkg ?? 'electron'
  const roots = new Set<string>([
    ...(typeof options?.cwd === 'string' ? [options.cwd] : []),
    ...(process.env.INIT_CWD ? [process.env.INIT_CWD] : []),
    process.cwd(),
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
    process.electronApp = undefined
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

  const targetArgv = [...argv]

  for (const [envName, flag] of Object.entries(startupEnv)) {
    const value = parseEnvVar(process.env[envName]?.trim())
    if (!value) {
      continue
    }
    if (value === true) {
      targetArgv.push(flag)
    } else {
      targetArgv.push(`${flag}=${value}`)
    }
  }

  const electronApp = spawn(electronPath, targetArgv, {
    stdio,
    ...options,
  })

  process.electronApp = electronApp
  electronKillSignals.set(electronApp, options?.killSignal ?? 'SIGTERM')
  bindElectronExit(electronApp, onExit)

  return true
}

export const startup: StartupFn = (argv, options, customElectronPkg) =>
  startElectron(argv, options, customElectronPkg)

startup.send = (message: string) => {
  if (process.electronApp) {
    // Based on { stdio: [,,, 'ipc'] }
    process.electronApp.send?.(message)
  }
}
startup.hookedProcessExit = startup.prevent = false
startup.exit = (signal) => {
  const electronApp = process.electronApp
  if (!electronApp) {
    return Promise.resolve()
  }

  const pendingExit = electronExitPromises.get(electronApp)
  if (pendingExit) {
    return pendingExit
  }

  unbindElectronExit(electronApp)

  const exitPromise = (async () => {
    if (electronApp.exitCode !== null || electronApp.signalCode !== null) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        electronApp.removeListener('close', onClose)
        electronApp.removeListener('error', onError)
      }
      const onClose = () => {
        cleanup()
        resolve()
      }
      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }

      electronApp.once('close', onClose)
      electronApp.once('error', onError)

      try {
        const killSignal = signal ?? electronKillSignals.get(electronApp) ?? 'SIGTERM'
        if (!electronApp.kill(killSignal)) {
          cleanup()
          resolve()
        }
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  })().finally(() => {
    electronExitPromises.delete(electronApp)
    electronKillSignals.delete(electronApp)
    if (process.electronApp === electronApp) {
      process.electronApp = undefined
    }
  })

  electronExitPromises.set(electronApp, exitPromise)
  return exitPromise
}

export interface OnStartOptions {
  /**
   * Triggered when Vite is built every time -- `vite serve` command only.
   *
   * If this `onstart` is passed, Electron App will not start automatically.
   * However, you can start Electron App via `startup` function.
   */
  onstart?: (args: {
    /**
     * Electron App startup function.
     * It will mount the Electron App child-process to `process.electronApp`.
     *
     * You can also set environment variables to control the Electron CLI flags.
     * `1` or `true` turns a flag on, `0` or `false` turns it off, and any other non-empty
     * value is appended as `=<value>`.
     *
     * Supported env vars:
     * - `REMOTE_DEBUGGING_PORT` appends `--remote-debugging-port=<value>`
     * - `ELECTRON_IGNORE_CERTIFICATE_ERRORS` appends `--ignore-certificate-errors`
     * - `ELECTRON_DISABLE_WEB_SECURITY` appends `--disable-web-security`
     * - `ELECTRON_INSPECT` appends `--inspect` or `--inspect=<value>`
     * - `ELECTRON_INSPECT_BRK` appends `--inspect-brk` or `--inspect-brk=<value>`
     *
     * @param argv default value `['.', '--no-sandbox']`
     * @param options options for `child_process.spawn`
     * @param customElectronPkg custom electron package name (default: 'electron')
     * @returns `true` if the Electron app is started, or `false` if startup is prevented by `startup.prevent` or `ELECTRON_STARTUP_PREVENT`.
     */
    startup: (
      argv?: string[],
      options?: import('node:child_process').SpawnOptions,
      customElectronPkg?: string,
    ) => Promise<boolean>
    /** Reload Electron-Renderer */
    reload: () => void
  }) => void | Promise<void>
}

/**
 * Trigger the startup of the Electron app during development.
 * If `options.onstart` is provided, it will be called with a `startup` function and a `reload` function.
 * Otherwise, the Electron app will start immediately.
 * @param context The `this` of `configServer()` hook, used for calling `this` in `options.onstart`.
 * @param server The Vite development server instance.
 * @param options The `onstart` options
 */
export function triggerStartup(
  context: ConfigServerContext,
  server: ViteDevServer,
  options: OnStartOptions,
): void {
  const startupWithRoot = (
    argv?: string[],
    spawnOptions?: import('node:child_process').SpawnOptions,
    customElectronPkg?: string,
  ) => {
    return startElectron(
      argv,
      { cwd: server.config.root, ...spawnOptions },
      customElectronPkg,
      (code) => {
        if (code !== null) {
          process.exitCode ??= code
        }
        void server.close()
      },
    )
  }
  if (options.onstart) {
    options.onstart.call(context, {
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
}

export const defaultPreloadOnstart: OnStartOptions['onstart'] = async (args) => {
  // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete,
  // instead of restarting the entire Electron App.
  args.reload()
}
