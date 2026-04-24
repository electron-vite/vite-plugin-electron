import { version } from 'vite'
import type {
  Plugin,
  ConfigEnv,
  UserConfig,
  ViteDevServer,
  MinimalPluginContextWithoutEnvironment,
} from 'vite'

import { resolveServerUrl, resolveInput, setupMockHtml, checkESModule } from './utils'

interface FactoryOptions {
  prefix: string
  dev: (
    pluginContext: MinimalPluginContextWithoutEnvironment,
    server: ViteDevServer,
    isESM: boolean,
  ) => Promise<void> | void
  build: (userConfig: UserConfig, configEnv: ConfigEnv, isESM: boolean) => Promise<void> | void
}

export function createElectronPlugin({ prefix, dev, build }: FactoryOptions): Plugin[] {
  let userConfig: UserConfig
  let configEnv: ConfigEnv
  let cleanupMock: (() => Promise<void>) | undefined

  if (Number.parseInt(version) < 8) {
    throw new Error(
      `[vite-plugin-electron] Vite v${version} does not support \`rolldownOptions\`, please install \`vite@>=8\` or use \`vite-plugin-electron@0.29.1\`.`,
    )
  }

  const isESM = checkESModule()

  return [
    {
      name: `${prefix}:dev`,
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

        server.httpServer?.once('listening', async () => {
          Object.assign(process.env, {
            VITE_DEV_SERVER_URL: resolveServerUrl(server),
          })

          dev(this, server, isESM)
        })
      },
    },
    {
      name: `${prefix}:prod`,
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
