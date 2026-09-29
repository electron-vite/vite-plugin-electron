import { constants } from 'node:os'

import type { Plugin, ConfigEnv, UserConfig, ViteDevServer, ServerHook } from 'vite'

import { startup } from './startup'
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
  let sigintHandler: (() => void) | undefined
  let shutdownSignal: NodeJS.Signals | undefined
  let closing: Promise<void> | undefined
  let devStarted: Promise<DevCleanup | void> | undefined
  let session: DevSession | undefined

  let isESM: boolean

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
        isESM = checkESModule(config.root)
        // When there is no entry (no index.html and no configured input), write a
        // temporary mock so that Vite's dev server starts without errors.
        if (!resolveInput(config)) {
          cleanupMock = setupMockHtml(config, false, config.logger)
        }
      },
      closeBundle() {
        if (session) {
          session.closed = true
        }
        return (closing ??= (async () => {
          if (sigintHandler) {
            process.removeListener('SIGINT', sigintHandler)
            sigintHandler = undefined
          }

          const cleanup = cleanupMock
          cleanupMock = undefined
          let firstError: unknown
          try {
            await cleanup?.()
          } catch (error) {
            firstError = error
          }
          try {
            if (devStarted) {
              const closeDev = await devStarted
              await closeDev?.()
            }
          } catch (error) {
            firstError ??= error
          }
          try {
            await startup.exit(shutdownSignal)
          } catch (error) {
            firstError ??= error
          }
          if (firstError) {
            throw firstError
          }
        })())
      },
      configureServer(server) {
        session = { closed: false }
        const currentSession = session
        shutdownSignal = undefined
        closing = undefined
        devStarted = undefined

        if (sigintHandler) {
          process.removeListener('SIGINT', sigintHandler)
        }
        if (!server.config.server.middlewareMode) {
          sigintHandler = () => {
            shutdownSignal = 'SIGINT'
            void (async () => {
              try {
                await server.close()
              } finally {
                // Shells report signal termination as 128 plus the signal number.
                process.exit(128 + constants.signals.SIGINT)
              }
            })()
          }
          process.once('SIGINT', sigintHandler)
        }

        server.httpServer?.once('listening', async () => {
          if (currentSession.closed) {
            return
          }
          Object.assign(process.env, {
            VITE_DEV_SERVER_URL: resolveServerUrl(server),
          })

          devStarted = Promise.resolve(dev(this, server, isESM, currentSession))
          await devStarted
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
