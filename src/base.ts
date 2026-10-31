import { constants } from 'node:os'

import type { Plugin, ConfigEnv, UserConfig, ViteDevServer, ServerHook } from 'vite'

import { startup } from './startup'
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
    const child = process.electronApp
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone (an unhandled `error` from a dying child must not change the exit code).
      }
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
      configureServer(server) {
        // Middleware hosts own the process lifetime and its signals.
        if (server.httpServer && !server.config.server.middlewareMode) {
          superviseSigint(server)
        }

        server.httpServer?.once('close', () => {
          releaseSigint(server)
          const closing = (async () => {
            if (cleanupMock) {
              await cleanupMock()
              cleanupMock = undefined
            }
            await startup.exit()
          })().catch(() => {})
          pendingCloses.add(closing)
          void closing.finally(() => pendingCloses.delete(closing))
        })

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
