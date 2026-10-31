import { constants } from 'node:os'
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'

import type { Plugin, ConfigEnv, UserConfig, ViteDevServer, ServerHook, ResolvedConfig } from 'vite'

import { exitElectron, getUnownedElectron, killElectronSync } from './startup'
import type { DevSession } from './startup'
import { resolveServerUrl, resolveInput, setupMockHtml, checkESModule, setIsViteDev } from './utils'

export type ConfigServerContext = ThisParameterType<ServerHook>
type DevCleanup = () => void | Promise<void>

export async function closeWatchers(watchers: { close: () => Promise<void> }[]): Promise<void> {
  const results = await Promise.allSettled(watchers.map(async (watcher) => watcher.close()))
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    throw failure.reason
  }
}

interface FactoryOptions {
  prefix: string
  dev: (
    pluginContext: ConfigServerContext,
    server: ViteDevServer,
    isESM: boolean,
    session: DevSession,
  ) => DevCleanup | void | Promise<DevCleanup | void>
  build: (userConfig: UserConfig, configEnv: ConfigEnv, isESM: boolean) => Promise<void> | void
  buildConfig?: (config: UserConfig, env: ConfigEnv) => Promise<UserConfig | undefined>
}

interface ConfigState {
  isESM: boolean
  cleanupMock?: () => Promise<void>
}
interface Session extends DevSession, ConfigState {
  server: ViteDevServer
  devStarted?: Promise<DevCleanup | void>
  closing?: Promise<void>
  shutdownSignal?: NodeJS.Signals
  /** Child whose exit will release this session after a failed shutdown. */
  exitWatch?: ChildProcess
}

// Process-wide state. The Vite CLI re-evaluates `vite.config.ts` on every restart, creating new
// plugin instances, and a config may mount several electron() plugins. Ctrl+C supervision and the
// mock `index.html` lease must span all of them, so they live here rather than per instance.
const mocks = new Map<
  string,
  { references: number; cleanup: () => Promise<void>; cleaning?: Promise<void> }
>()
// Sessions not yet fully closed (still serving, or waiting for their Electron child to exit).
const pendingSessions = new Set<Session>()
let sigintShutdownStarted = false

function removeSigintHandler() {
  process.removeListener('SIGINT', onSigint)
  sigintShutdownStarted = false
}

function onSigint() {
  if (sigintShutdownStarted) {
    // Second Ctrl+C: like the OS default for an unhandled SIGINT, stop waiting and exit
    // now. Kill owned Electron children first so they do not outlive the host.
    for (const owned of pendingSessions) {
      if (owned.electronApp) {
        killElectronSync(owned.electronApp)
      }
    }
    removeSigintHandler()
    process.exit(128 + constants.signals.SIGINT)
    return
  }
  sigintShutdownStarted = true
  const pending = [...pendingSessions]
  // Sessions whose server is still serving; earlier generations already closed theirs.
  const servers = new Set(pending.filter((owned) => !owned.closed).map((owned) => owned.server))
  for (const owned of pending) {
    owned.closed = true
    owned.shutdownSignal = 'SIGINT'
  }
  void (async () => {
    // A restart can publish B while A is still waiting for its child.
    // Wait for every generation and plugin instance, even if closing Vite rejects.
    await Promise.allSettled([
      ...pending.map(closeSession),
      ...[...servers].map((server) => Promise.resolve().then(() => server.close())),
    ])
    // Shells report signal termination as 128 plus the signal number.
    process.exit(128 + constants.signals.SIGINT)
  })()
}

/**
 * Supervise Ctrl+C while a pending session belongs to a server that owns the process lifetime
 * (not middleware mode). Middleware hosts handle their own signals.
 */
function updateSigintHandler() {
  const needed = [...pendingSessions].some((owned) => !owned.server.config.server.middlewareMode)
  if (needed && !process.listeners('SIGINT').includes(onSigint)) {
    sigintShutdownStarted = false
    // Use `on`, not `once`: the second SIGINT must still kill Electron before exiting.
    process.on('SIGINT', onSigint)
  } else if (!needed) {
    removeSigintHandler()
  }
}

function closeSession(session: Session): Promise<void> {
  session.closed = true
  if (session.closing) {
    return session.closing
  }
  const closing = (async () => {
    const errors: unknown[] = []
    try {
      await session.cleanupMock?.()
    } catch (error) {
      errors.push(error)
    }
    try {
      const cleanup = await session.devStarted
      await cleanup?.()
    } catch (error) {
      errors.push(error)
    }
    try {
      // A child started through the exported `startup()` has no session; stop it too, unless
      // another session owns it.
      const child = session.electronApp ?? getUnownedElectron()
      if (child) {
        await exitElectron(child, session.shutdownSignal)
        // Resolved means the child exited; release it even if it was not bound to this session.
        if (session.electronApp === child) {
          session.electronApp = undefined
        }
      }
    } catch (error) {
      errors.push(error)
    } finally {
      const stale = session.electronApp
      if (!stale) {
        pendingSessions.delete(session)
      } else if (session.exitWatch !== stale) {
        // Shutdown failed: release the session once the child exits on its own.
        session.exitWatch = stale
        const release = () => {
          if (session.electronApp === stale) {
            session.electronApp = undefined
          }
          pendingSessions.delete(session)
          updateSigintHandler()
        }
        if (stale.exitCode !== null || stale.signalCode !== null) {
          release()
        } else {
          stale.once('exit', release)
        }
      }
      // Keep supervising earlier generations until all owned children exit.
      updateSigintHandler()
    }
    if (errors.length) {
      throw errors[0]
    }
  })()
  session.closing = closing
  // A failed close must be retryable: clear the cached rejection so close() can run again.
  void closing.catch(() => {
    if (session.closing === closing) {
      session.closing = undefined
    }
  })
  return closing
}

export function createElectronPlugin({
  prefix,
  buildConfig,
  dev,
  build,
}: FactoryOptions): Plugin[] {
  let userConfig: UserConfig
  let configEnv: ConfigEnv
  let cleanupMock: (() => Promise<void>) | undefined
  let isESM: boolean

  const configs = new WeakMap<ResolvedConfig, ConfigState>()
  // Per instance: two electron() plugins on one server each own a session for its environments.
  const sessions = new WeakMap<object, Session>()

  return [
    {
      name: `${prefix}:dev`,
      apply: 'serve',
      config(_, env) {
        if (env.command === 'serve') {
          setIsViteDev()
        }
      },
      async configResolved(config) {
        const state: ConfigState = { isESM: checkESModule(config.root) }
        let mock = mocks.get(config.root)
        // The last release is still deleting the mock file. Wait for it so this session neither
        // mistakes the file for a real entry nor has it deleted underneath it.
        while (mock?.cleaning) {
          await mock.cleaning.catch(() => {})
          if (mocks.get(config.root) === mock) {
            mocks.delete(config.root)
          }
          mock = mocks.get(config.root)
        }
        const input = resolveInput(config)
        // A restart (or a second electron() plugin) resolves B while A's mock still exists.
        // Give B its own lease; the map is process-wide so new plugin instances see A's mock.
        if (!input || (mock && input === path.join(config.root, 'index.html'))) {
          if (!mock) {
            mock = { references: 0, cleanup: setupMockHtml(config, false, config.logger) }
            mocks.set(config.root, mock)
          }
          const ownedMock = mock
          ownedMock.references++
          let released = false
          state.cleanupMock = async () => {
            if (released) {
              return
            }
            released = true
            if (--ownedMock.references === 0) {
              // Keep the entry until the file is gone so new sessions can coordinate with it.
              const cleaning = ownedMock.cleanup().finally(() => {
                if (mocks.get(config.root) === ownedMock) {
                  mocks.delete(config.root)
                }
              })
              ownedMock.cleaning = cleaning
              await cleaning
            }
          }
        }
        configs.set(config, state)
      },
      closeBundle() {
        // Vite 6+ calls this hook per environment, including during restart.
        // The environment identity survives even when Vite replaces server fields.
        const session = sessions.get(this.environment)
        return session ? closeSession(session) : Promise.resolve()
      },
      configureServer(server) {
        const session: Session = {
          closed: false,
          server,
          ...(configs.get(server.config) ?? { isESM: false }),
        }
        pendingSessions.add(session)
        for (const environment of Object.values(server.environments ?? {})) {
          sessions.set(environment, session)
        }
        updateSigintHandler()

        server.httpServer?.once('listening', async () => {
          if (session.closed) {
            return
          }
          Object.assign(process.env, {
            VITE_DEV_SERVER_URL: resolveServerUrl(server),
          })

          session.devStarted = new Promise((resolve) => {
            resolve(dev(this, server, session.isESM, session))
          })
          await session.devStarted
        })
      },
    },
    {
      name: `${prefix}:prod`,
      apply: 'build',
      async config(config, env) {
        userConfig = config
        configEnv = env

        return {
          // Make sure that Electron can be loaded into the local file using `loadFile` after packaging.
          ...(config.base ? {} : { base: './' }),
          ...(await buildConfig?.(config, env)),
        }
      },
      configResolved(config) {
        isESM = checkESModule(config.root)
        // When there is no entry (no index.html and no configured input), write a
        // temporary mock so that Vite's build has a valid entry point.
        if (!resolveInput(config)) {
          cleanupMock = setupMockHtml(config, true, config.logger)
        }
      },
      async closeBundle() {
        try {
          await build(userConfig, configEnv, isESM)
        } finally {
          // Remove mock files created in configResolved before building Electron.
          if (cleanupMock) {
            await cleanupMock()
            cleanupMock = undefined
          }
        }
      },
    },
  ]
}
