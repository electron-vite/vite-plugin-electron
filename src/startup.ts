import type { ChildProcess, SpawnOptions, StdioOptions } from 'node:child_process'
import path from 'node:path'

import type { ViteDevServer } from 'vite'

import type { ConfigServerContext } from './base'
import { withTreeKillHook } from './tree-kill-hook'
import { killOrphanedChildrenSync, killPidsSync, listDescendantPids, treeKillSync } from './utils'

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
const ELECTRON_SHUTDOWN_TIMEOUT = 5_000
export interface DevSession {
  closed: boolean
  electronApp?: ChildProcess
}

interface ElectronLifecycle {
  session?: DevSession
  exitHandler?: ElectronExitHandler
  exitPromise?: Promise<void>
}

const electronLifecycles = new WeakMap<ChildProcess, ElectronLifecycle>()
const exitedChildren = new WeakSet<ChildProcess>()
// Children spawned while `startup.treeKill` was enabled. Only these get descendant cleanup.
const treeKillChildren = new WeakSet<ChildProcess>()
let pendingSpawn: Promise<void> = Promise.resolve()

// Children still alive, for the synchronous host-exit safety net below.
const liveChildren = new Set<ChildProcess>()
let hostExitHookInstalled = false

function hasChildExited(child: ChildProcess): boolean {
  return exitedChildren.has(child) || child.exitCode !== null || child.signalCode !== null
}

/**
 * Synchronously SIGKILL a live Electron child. Children started with `startup.treeKill` are
 * tree-killed; otherwise only the direct child is signaled.
 */
export function killElectronSync(child: ChildProcess): void {
  if (hasChildExited(child)) {
    return
  }
  if (child.pid && treeKillChildren.has(child)) {
    treeKillSync(child.pid, 'SIGKILL')
    return
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // Already gone.
  }
}

/**
 * If the host exits by any path (process.exit, uncaught error, ...) while an Electron child is
 * still alive, kill it synchronously. Normal shutdown paths clear children first, so this
 * is a no-op for them and never changes the exit code.
 */
function onHostExit(): void {
  for (const child of liveChildren) {
    killElectronSync(child)
  }
  liveChildren.clear()
}

function trackLiveChild(child: ChildProcess): void {
  liveChildren.add(child)
  if (!hostExitHookInstalled) {
    hostExitHookInstalled = true
    process.on('exit', onHostExit)
  }
}

function untrackLiveChild(child: ChildProcess): void {
  liveChildren.delete(child)
  if (liveChildren.size === 0 && hostExitHookInstalled) {
    hostExitHookInstalled = false
    process.removeListener('exit', onHostExit)
  }
}

function clearElectron(child: ChildProcess, lifecycle: ElectronLifecycle): void {
  exitedChildren.add(child)
  untrackLiveChild(child)
  // Descendants may keep inherited pipes open after the direct child exits.
  // Preserve stream consumers, but do not let those pipes keep the host alive.
  for (const stream of child.stdio ?? []) {
    if (stream && 'unref' in stream && typeof stream.unref === 'function') {
      stream.unref()
    }
  }
  electronLifecycles.delete(child)
  if (lifecycle.session?.electronApp === child) {
    lifecycle.session.electronApp = undefined
  }
  if (process.electronApp === child) {
    process.electronApp = undefined
  }
}

function bindElectronExit(
  child: ChildProcess,
  onExit: ElectronExitHandler,
  session?: DevSession,
): void {
  const lifecycle: ElectronLifecycle = { session }
  // Only runs when Electron exits by itself: exitElectron() detaches this handler first and
  // (with treeKill) reaps descendants from its own pre-kill snapshot.
  const handler: ElectronExitHandler = (code, signal) => {
    if (child.pid && treeKillChildren.has(child)) {
      // Windows: detached helpers keep the stale parent id; reap them before the host exits.
      killOrphanedChildrenSync(child.pid)
    }
    clearElectron(child, lifecycle)
    onExit(code, signal)
  }
  lifecycle.exitHandler = handler
  electronLifecycles.set(child, lifecycle)
  child.once('exit', handler)
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
   * Kill the processes the Electron app started. Defaults to `false`, in which case the plugin
   * only signals and waits for the direct Electron child, and the app must stop its own child
   * processes before quitting.
   *
   * Without this, Electron on Windows stays alive after quitting while a process it started
   * before its first window is still running. When enabled:
   * - a script is preloaded into the Electron main process via `NODE_OPTIONS=--require` that
   *   kills the app's descendant processes when Electron exits (Chromium's own helpers excluded);
   * - plugin-initiated shutdowns (restart, `startup.exit()`, Ctrl+C) snapshot the descendants
   *   before signaling and kill leftovers afterward, and `SIGKILL` kills the whole tree;
   * - on Windows, processes orphaned by an Electron self-exit are tree-killed.
   *
   * The process-table scans are synchronous and add a short delay to each restart and shutdown
   * (about 1 second on Windows).
   *
   * Applies to Electron apps started after it is set. Set it on the imported `startup`,
   * e.g. `startup.treeKill = true` in `vite.config.ts`.
   */
  treeKill: boolean
  /**
   * Stop the current Electron app and resolve after the direct Electron child process exits.
   * With `startup.treeKill`, leftover descendants discovered before the signal are cleaned up
   * afterward.
   * @param signal shutdown signal (defaults to SIGTERM)
   */
  exit: (signal?: KillSignal) => Promise<void>
}

export const startup: StartupFn = (argv, options, customElectronPkg) =>
  startElectron(argv, options, customElectronPkg)

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
 * @returns `true` if the Electron app is started, or `false` if startup is prevented or its dev session has closed.
 */
async function startElectron(
  argv = ['.', '--no-sandbox'],
  options?: SpawnOptions,
  customElectronPkg?: string,
  onExit: ElectronExitHandler = (code) => process.exit(code ?? 0),
  session?: DevSession,
): Promise<boolean> {
  if (
    session?.closed ||
    startup.prevent ||
    parseEnvVar(process.env.ELECTRON_STARTUP_PREVENT?.trim())
  ) {
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
    throw new Error(
      `Unable to resolve "${electronPackage}". Install it in the app project or pass startup(..., ..., customElectronPkg).`,
      { cause: resolutionError as Error },
    )
  }

  const electronPath = electron.default ?? electron

  const previousSpawn = pendingSpawn
  let releaseSpawn!: () => void
  pendingSpawn = new Promise<void>((resolve) => {
    releaseSpawn = resolve
  })
  await previousSpawn

  try {
    if (session?.closed) {
      return false
    }
    if (session) {
      if (session.electronApp) {
        await exitElectron(session.electronApp)
      } else if (process.electronApp) {
        // Replace an unowned global child (manual startup() before a session start).
        // Do not kill a child owned by a different live session.
        const life = electronLifecycles.get(process.electronApp)
        if (!life?.session || life.session === session) {
          await exitElectron(process.electronApp)
        }
      }
    } else {
      await startup.exit()
    }
    if (session?.closed) {
      return false
    }

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
      ...(startup.treeKill ? { env: withTreeKillHook(options?.env ?? process.env) } : {}),
    })

    process.electronApp = electronApp
    if (startup.treeKill) {
      treeKillChildren.add(electronApp)
    }
    trackLiveChild(electronApp)
    if (session) {
      session.electronApp = electronApp
    }
    bindElectronExit(electronApp, onExit, session)

    return true
  } finally {
    releaseSpawn()
  }
}

startup.send = (message: string) => {
  if (process.electronApp) {
    // Based on { stdio: [,,, 'ipc'] }
    process.electronApp.send?.(message)
  }
}
startup.hookedProcessExit = startup.prevent = startup.treeKill = false
startup.exit = (signal) => {
  const child = process.electronApp
  return child ? exitElectron(child, signal) : Promise.resolve()
}

/** Internal shutdown primitive: never reads the current global child. */
export function exitElectron(child: ChildProcess, signal?: KillSignal): Promise<void> {
  let lifecycle = electronLifecycles.get(child)
  if (!lifecycle) {
    lifecycle = {}
    electronLifecycles.set(child, lifecycle)
  }
  const state = lifecycle
  if (state.exitPromise) {
    // Allow a later SIGKILL to escalate an in-flight graceful exit.
    if (signal === 'SIGKILL') {
      killElectronSync(child)
    }
    return state.exitPromise
  }

  const exitHandler = state.exitHandler
  if (exitHandler) {
    child.removeListener('exit', exitHandler)
    state.exitHandler = undefined
  }

  const hasExited = () => hasChildExited(child)

  // With treeKill, snapshot while the direct child is still alive so detached helpers can be
  // reaped. Skipped by default: the scan is synchronous and slow on Windows.
  const knownDescendants =
    treeKillChildren.has(child) && !hasExited() && child.pid ? listDescendantPids(child.pid) : []

  const exitPromise = new Promise<void>((resolve, reject) => {
    if (hasExited()) {
      resolve()
      return
    }

    let timeout: NodeJS.Timeout | undefined
    function cleanup() {
      clearTimeout(timeout)
      child.removeListener('exit', onExit)
      child.removeListener('error', onError)
    }
    function onExit() {
      cleanup()
      exitedChildren.add(child)
      resolve()
    }
    function onError(error: Error) {
      cleanup()
      reject(error)
    }
    function kill(requestedSignal: KillSignal) {
      try {
        if (requestedSignal === 'SIGKILL') {
          killElectronSync(child)
          if (hasExited()) {
            onExit()
          }
          return
        }
        // Windows child.kill(SIGINT|SIGTERM) is TerminateProcess on one pid; with treeKill,
        // leftovers are reaped after exit via knownDescendants. POSIX gets a real signal first.
        if (!child.kill(requestedSignal)) {
          if (hasExited()) {
            onExit()
          } else {
            onError(new Error(`Failed to send ${requestedSignal} to Electron child`))
          }
        }
      } catch (error) {
        onError(error as Error)
      }
    }

    child.once('exit', onExit)
    child.once('error', onError)
    timeout = setTimeout(() => {
      if (!hasExited()) {
        kill('SIGKILL')
      }
    }, ELECTRON_SHUTDOWN_TIMEOUT)
    kill(signal ?? 'SIGTERM')
  }).then(
    () => {
      clearElectron(child, state)
      if (knownDescendants.length) {
        killPidsSync(knownDescendants)
      }
    },
    (error: unknown) => {
      if (hasExited()) {
        clearElectron(child, state)
        if (knownDescendants.length) {
          killPidsSync(knownDescendants)
        }
      } else {
        state.exitPromise = undefined
        if (exitHandler) {
          state.exitHandler = exitHandler
          child.once('exit', exitHandler)
        }
      }
      throw error
    },
  )

  state.exitPromise = exitPromise
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
     * @returns `true` if the Electron app is started, or `false` if startup is prevented or its dev session has closed.
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
  session?: DevSession,
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
        if (session?.closed) {
          return
        }
        if (code !== null) {
          process.exitCode ??= code
        }
        // `async` turns a synchronous throw from close() into a rejection.
        const closing = (async () => server.close())().catch(() => {})
        // Middleware hosts own the process lifetime. The Vite CLI does not exit by itself after
        // close() (its stdin shortcut reader stays open), so end it like the Ctrl+C path does.
        if (!server.config.server?.middlewareMode) {
          void closing.then(() => process.exit())
        }
      },
      session,
    )
  }
  if (options.onstart) {
    options.onstart.call(context, {
      startup: startupWithRoot,
      // Why not use Vite's built-in `/@vite/client` to implement Hot reload?
      // Because Vite only inserts `/@vite/client` into the `*.html` entry file, the preload scripts are usually a `*.js` file.
      // @see - https://github.com/vitejs/vite/blob/v5.2.11/packages/vite/src/node/server/middlewares/indexHtml.ts#L399
      reload() {
        if (session?.closed) {
          return
        }
        const live = session?.electronApp ?? process.electronApp
        if (live) {
          ;(server.hot || server.ws).send({ type: 'full-reload' })

          // For Electron apps that don't need to use the renderer process.
          live.send?.('electron-vite&type=hot-reload')
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
