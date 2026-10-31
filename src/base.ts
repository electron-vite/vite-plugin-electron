import { constants } from 'node:os'
import path from 'node:path'

import type { Plugin, ConfigEnv, UserConfig, ViteDevServer, ServerHook, ResolvedConfig } from 'vite'

import { killElectronSync, startup } from './startup'
import type { DevSession } from './startup'
import { resolveServerUrl, resolveInput, setupMockHtml, checkESModule, setIsViteDev } from './utils'

export type ConfigServerContext = ThisParameterType<ServerHook>

// Vite only handles SIGTERM, so an unhandled SIGINT (Ctrl+C) would end this process at once while
// Electron is still shutting down. Supervise it here: close the servers, wait for Electron to
// exit, then exit with the conventional 128 + signal code.
const SIGINT_EXIT_CODE = 128 + constants.signals.SIGINT
/** Dev servers that own the process lifetime (not middleware mode). */
const supervisedServers = new Set<ViteDevServer>()
/** Per-server cleanup that must finish before the process exits. */
const pendingCloses = new Set<Promise<void>>()
let sigintReceived = false

function onSigint() {
  if (sigintReceived) {
    // Second Ctrl+C: stop waiting, but do not leave Electron behind.
    if (process.electronApp) {
      killElectronSync(process.electronApp)
    }
    process.exit(SIGINT_EXIT_CODE)
  }
  sigintReceived = true
  void (async () => {
    await Promise.allSettled([
      startup.exit('SIGINT'),
      ...[...supervisedServers].map(async (server) => server.close()),
    ])
    await Promise.allSettled(pendingCloses)
    process.exit(SIGINT_EXIT_CODE)
  })()
}

function superviseSigint(server: ViteDevServer) {
  supervisedServers.add(server)
  if (!process.listeners('SIGINT').includes(onSigint)) {
    sigintReceived = false
    // `on`, not `once`: the second SIGINT must still reach the handler.
    process.on('SIGINT', onSigint)
  }
}

function releaseSigint(server: ViteDevServer) {
  supervisedServers.delete(server)
  // During a Ctrl+C shutdown, keep handling SIGINT so a second Ctrl+C still kills Electron.
  if (supervisedServers.size === 0 && !sigintReceived) {
    process.removeListener('SIGINT', onSigint)
  }
}

/** Releases what `dev()` set up (e.g. build watchers) when its dev server closes. */
export type DevCleanup = () => void | Promise<void>

/** Close every watcher, even if one fails; rethrow the first failure. */
export async function closeWatchers(watchers: { close: () => Promise<void> }[]): Promise<void> {
  const results = await Promise.allSettled(watchers.map(async (watcher) => watcher.close()))
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) {
    throw failure.reason
  }
}

// The mock `index.html` is shared per root, process-wide: on a Vite restart the new server
// resolves its config (and sees the mock as if it were a real entry) before the old one closes,
// and the Vite CLI re-evaluates `vite.config.ts`, so it may be a new plugin instance.
interface MockLease {
  references: number
  cleanup: () => Promise<void>
  /** Set while the last holder is deleting the file. */
  cleaning?: Promise<void>
}
const mocks = new Map<string, MockLease>()

async function acquireMock(config: ResolvedConfig): Promise<(() => Promise<void>) | undefined> {
  let mock = mocks.get(config.root)
  // The last holder is still deleting the mock; wait so it is neither mistaken for a real entry
  // nor deleted underneath the new holder.
  while (mock?.cleaning) {
    await mock.cleaning.catch(() => {})
    mock = mocks.get(config.root)
  }
  const input = resolveInput(config)
  // A real entry, unless it is just the mock another live server holds.
  if (input && (!mock || input !== path.resolve(config.root, 'index.html'))) {
    return undefined
  }
  if (!mock) {
    // When there is no entry (no index.html and no configured input), write a
    // temporary mock so that Vite's dev server starts without errors.
    mock = { references: 0, cleanup: setupMockHtml(config, false, config.logger) }
    mocks.set(config.root, mock)
  }
  const lease = mock
  lease.references++
  let released = false
  return async () => {
    if (released) {
      return
    }
    released = true
    if (--lease.references === 0) {
      lease.cleaning = lease.cleanup().finally(() => {
        if (mocks.get(config.root) === lease) {
          mocks.delete(config.root)
        }
      })
      await lease.cleaning
    }
  }
}

interface Session extends DevSession {
  server: ViteDevServer
  isESM: boolean
  cleanupMock?: () => Promise<void>
  devStarted?: Promise<DevCleanup | void>
  closing?: Promise<void>
}

/** Close a dev server's session: stop its build watchers, release the mock and stop Electron. */
function closeSession(session: Session): Promise<void> {
  if (session.closing) {
    return session.closing
  }
  session.closed = true
  releaseSigint(session.server)
  const closing = (async () => {
    const errors: unknown[] = []
    const attempt = async (step: () => unknown) => {
      try {
        await step()
      } catch (error) {
        errors.push(error)
      }
    }
    await attempt(() => session.cleanupMock?.())
    // `dev()` may still be building; wait for it so its watchers are closed too. A failed start
    // was already reported by the `listening` handler (and closed its own watchers).
    const cleanup = await session.devStarted?.catch(() => undefined)
    await attempt(() => cleanup?.())
    await attempt(() => startup.exit())
    if (errors.length) {
      throw errors[0]
    }
  })()
  session.closing = closing
  pendingCloses.add(closing)
  void closing.catch(() => {}).finally(() => pendingCloses.delete(closing))
  return closing
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

  // Dev state is per server: `server.restart()` reuses this plugin instance for a new server.
  const devConfigs = new WeakMap<ResolvedConfig, Pick<Session, 'isESM' | 'cleanupMock'>>()
  // Keyed by environment, which is what `closeBundle` can see.
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
        devConfigs.set(config, {
          isESM: checkESModule(config.root),
          cleanupMock: await acquireMock(config),
        })
      },
      // Vite awaits this for each environment when the dev server closes, including on restart,
      // so the old session is fully released before the new server starts listening.
      closeBundle() {
        const session = sessions.get(this.environment)
        return session ? closeSession(session) : undefined
      },
      configureServer(server) {
        const session: Session = {
          closed: false,
          server,
          ...(devConfigs.get(server.config) ?? { isESM: false }),
        }
        for (const environment of Object.values(server.environments ?? {})) {
          sessions.set(environment, session)
        }

        // Middleware hosts own the process lifetime and its signals.
        if (server.httpServer && !server.config.server.middlewareMode) {
          superviseSigint(server)
        }

        server.httpServer?.once('listening', async () => {
          if (session.closed) {
            return
          }
          Object.assign(process.env, {
            VITE_DEV_SERVER_URL: resolveServerUrl(server),
          })

          session.devStarted = Promise.resolve().then(() =>
            dev(this, server, session.isESM, session),
          )
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
