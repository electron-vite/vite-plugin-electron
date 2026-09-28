import type { Plugin, ConfigEnv, UserConfig, ViteDevServer, ServerHook } from 'vite'

import { startup } from './startup'
import { resolveServerUrl, resolveInput, setupMockHtml, checkESModule, setIsViteDev } from './utils'

export type ConfigServerContext = ThisParameterType<ServerHook>

interface FactoryOptions {
  prefix: string
  dev: (
    pluginContext: ConfigServerContext,
    server: ViteDevServer,
    isESM: boolean,
  ) => Promise<void> | void
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
      async closeBundle() {
        if (sigintHandler) {
          process.removeListener('SIGINT', sigintHandler)
          sigintHandler = undefined
        }

        const cleanup = cleanupMock
        cleanupMock = undefined
        if (cleanup) {
          await cleanup()
        }

        await startup.exit(shutdownSignal)
      },
      configureServer(server) {
        shutdownSignal = undefined

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
                process.exitCode ??= 130
                process.exit()
              }
            })()
          }
          process.once('SIGINT', sigintHandler)
        }

        server.httpServer?.once('listening', async () => {
          Object.assign(process.env, {
            VITE_DEV_SERVER_URL: resolveServerUrl(server),
          })

          await dev(this, server, isESM)
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
