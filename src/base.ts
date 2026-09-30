import { constants } from 'node:os'
import path from 'node:path'

import type { Plugin, ConfigEnv, UserConfig, ViteDevServer, ServerHook, ResolvedConfig } from 'vite'

import { exitElectron } from './startup'
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

  interface ConfigState {
    isESM: boolean
    cleanupMock?: () => Promise<void>
  }
  interface Session extends DevSession, ConfigState {
    server: ViteDevServer
    devStarted?: Promise<DevCleanup | void>
    closing?: Promise<void>
    shutdownSignal?: NodeJS.Signals
  }
  const configs = new WeakMap<ResolvedConfig, ConfigState>()
  const sessions = new WeakMap<object, Session>()
  const mocks = new Map<string, { references: number; cleanup: () => Promise<void> }>()
  let activeSession: Session | undefined
  let sigintHandler: (() => void) | undefined

  function removeSigintHandler() {
    if (sigintHandler) {
      process.removeListener('SIGINT', sigintHandler)
      sigintHandler = undefined
    }
  }

  function closeSession(session: Session): Promise<void> {
    session.closed = true
    return (session.closing ??= (async () => {
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
        if (session.electronApp) {
          await exitElectron(session.electronApp, session.shutdownSignal)
        }
      } catch (error) {
        errors.push(error)
      } finally {
        // Closing an earlier generation must leave the active supervisor intact.
        if (activeSession === session) {
          removeSigintHandler()
        }
      }
      if (errors.length) {
        throw errors[0]
      }
    })())
  }

  return [
    {
      name: `${prefix}:dev`,
      apply: 'serve',
      config(_, env) {
        if (env.command === 'serve') {
          setIsViteDev()
        }
      },
      configResolved(config) {
        const state: ConfigState = { isESM: checkESModule(config.root) }
        const input = resolveInput(config)
        let mock = mocks.get(config.root)
        // A restart resolves B while A's mock still exists. Give B its own lease.
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
              mocks.delete(config.root)
              await ownedMock.cleanup()
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
        activeSession = session
        for (const environment of Object.values(server.environments ?? {})) {
          sessions.set(environment, session)
        }

        if (server.config.server.middlewareMode) {
          removeSigintHandler()
        } else if (!sigintHandler) {
          sigintHandler = () => {
            const current = activeSession
            if (!current || current.closed) {
              return
            }
            current.shutdownSignal = 'SIGINT'
            void (async () => {
              try {
                await current.server.close()
              } finally {
                // Shells report signal termination as 128 plus the signal number.
                process.exit(128 + constants.signals.SIGINT)
              }
            })()
          }
          process.once('SIGINT', sigintHandler)
        }

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
