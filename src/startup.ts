import { spawn } from 'node:child_process'
import type { ChildProcess, SpawnOptions, StdioOptions } from 'node:child_process'
import { createRequire } from 'node:module'
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

type KillSignal = NonNullable<SpawnOptions['killSignal']>

/** Grace period before a stuck Electron child is SIGKILLed during shutdown. */
const ELECTRON_SHUTDOWN_TIMEOUT = 5_000
/** Handlers that end the host when Electron exits by itself; detached before a planned shutdown. */
const selfExitHandlers = new WeakMap<ChildProcess, (code: number | null) => void>()
/** In-flight shutdowns, so concurrent `startup.exit()` calls share one wait. */
const exiting = new WeakMap<ChildProcess, Promise<void>>()
/** Chains Electron replacements so concurrent starts run one at a time. */
let spawnQueue: Promise<void> = Promise.resolve()

function terminate(child: ChildProcess, signal: KillSignal): Promise<void> {
  const pending = exiting.get(child)
  if (pending) {
    return pending
  }
  const handler = selfExitHandlers.get(child)
  if (handler) {
    child.removeListener('exit', handler)
    selfExitHandlers.delete(child)
  }
  const release = () => {
    if (process.electronApp === child) {
      process.electronApp = undefined
    }
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    release()
    return Promise.resolve()
  }
  const promise = new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), ELECTRON_SHUTDOWN_TIMEOUT)
    const done = () => {
      clearTimeout(timer)
      child.removeListener('exit', done)
      child.removeListener('error', done)
      release()
      resolve()
    }
    child.once('exit', done)
    child.once('error', done)
    child.kill(signal)
  })
  exiting.set(child, promise)
  return promise
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
   * Stop the current Electron app and resolve after it has exited.
   * It is SIGKILLed if it has not exited within 5 seconds.
   * @param signal signal sent to Electron (defaults to `SIGTERM`)
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
export const startup: StartupFn = (argv, options, customElectronPkg) =>
  startElectron(argv, options, customElectronPkg)

/** A dev server's claim on Electron startup. Closed sessions (e.g. after a Vite restart) never start Electron. */
export interface DevSession {
  closed: boolean
}

async function startElectron(
  argv = ['.', '--no-sandbox'],
  options?: SpawnOptions,
  customElectronPkg?: string,
  session?: DevSession,
  onSelfExit: (code: number | null) => void = (code) => process.exit(code ?? 0),
): Promise<boolean> {
  if (session?.closed) {
    return false
  }
  if (startup.prevent || parseEnvVar(process.env.ELECTRON_STARTUP_PREVENT?.trim())) {
    process.electronApp = undefined
    return false
  }
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

  // One replacement at a time: concurrent calls would otherwise both see no running app and
  // each spawn one, orphaning the first. The last caller wins.
  const previous = spawnQueue
  let release!: () => void
  spawnQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    await startup.exit()
    // The dev server may have closed while we were resolving or waiting.
    if (session?.closed) {
      return false
    }
    spawnElectron(electronPath, argv, options, onSelfExit)
    return true
  } finally {
    release()
  }
}

function spawnElectron(
  electronPath: string,
  argv: string[],
  options: SpawnOptions | undefined,
  onSelfExit: (code: number | null) => void,
): void {
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
  trackLiveChild(electronApp)

  // Exit command after Electron.app exits
  const handler = (code: number | null) => {
    selfExitHandlers.delete(electronApp)
    if (process.electronApp === electronApp) {
      process.electronApp = undefined
    }
    onSelfExit(code)
  }
  selfExitHandlers.set(electronApp, handler)
  electronApp.on('exit', handler)
}

// Safety net: if this process exits by any other path (`process.exit()`, an uncaught error, ...)
// while Electron is still running, do not leave it behind. Normal shutdowns wait for Electron
// first, so this is a no-op for them.
const liveChildren = new Set<ChildProcess>()
function killLiveChildren(): void {
  for (const child of liveChildren) {
    try {
      child.kill()
    } catch {
      // Already gone.
    }
  }
}
function trackLiveChild(child: ChildProcess): void {
  if (liveChildren.size === 0) {
    process.on('exit', killLiveChildren)
  }
  liveChildren.add(child)
  child.once('exit', () => {
    liveChildren.delete(child)
    if (liveChildren.size === 0) {
      process.removeListener('exit', killLiveChildren)
    }
  })
}
startup.send = (message: string) => {
  if (process.electronApp) {
    // Based on { stdio: [,,, 'ipc'] }
    process.electronApp.send?.(message)
  }
}
startup.hookedProcessExit = startup.prevent = false
startup.exit = (signal = 'SIGTERM') => {
  const child = process.electronApp
  return child ? terminate(child, signal) : Promise.resolve()
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
 * @param session The dev server's session; nothing is started once it is closed.
 */
export function triggerStartup(
  context: ConfigServerContext,
  server: ViteDevServer,
  options: OnStartOptions,
  session?: DevSession,
): void {
  // A watcher of a closed (e.g. restarted) dev server may still finish one last build.
  if (session?.closed) {
    return
  }
  // Plugin-driven starts have no caller to handle a failure; log it instead of crashing the
  // dev server with an unhandled rejection.
  const report = (error: unknown) => {
    server.config.logger.error(
      `[vite-plugin-electron] Electron startup failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      { error: error instanceof Error ? error : null },
    )
  }
  // When Electron quits by itself, close the dev server first so it cleans up (build watchers,
  // the mock `index.html`), then exit with Electron's exit code.
  const onSelfExit = (code: number | null) => {
    if (session?.closed) {
      // Already shutting down; the closing server decides how the process ends.
      return
    }
    void (async () => server.close())()
      .catch(() => {})
      .then(() => process.exit(code ?? 0))
  }
  const startupWithRoot = (
    argv?: string[],
    spawnOptions?: import('node:child_process').SpawnOptions,
    customElectronPkg?: string,
  ) => {
    return startElectron(
      argv,
      { cwd: server.config.root, ...spawnOptions },
      customElectronPkg,
      session,
      onSelfExit,
    )
  }
  if (options.onstart) {
    let started: void | Promise<void>
    try {
      started = options.onstart.call(context, {
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
            startupWithRoot().catch(report)
          }
        },
      })
    } catch (error) {
      report(error)
      return
    }
    Promise.resolve(started).catch(report)
  } else {
    startupWithRoot().catch(report)
  }
}

export const defaultPreloadOnstart: OnStartOptions['onstart'] = async (args) => {
  // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete,
  // instead of restarting the entire Electron App.
  args.reload()
}
