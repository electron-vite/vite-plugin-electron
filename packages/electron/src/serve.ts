import { spawn } from 'child_process'
import {
  type Plugin,
  type ViteDevServer,
  type UserConfig,
  type InlineConfig,
  build as viteBuild,
  mergeConfig,
} from 'vite'
import type { Configuration } from './types'
import {
  createWithExternal,
  resolveRuntime,
  resolveBuildConfig,
  checkPkgMain,
  resolveEnv,
} from './config'

/**
 * Custom start plugin
 */
export function onstart(onstart?: () => void): Plugin {
  return {
    name: 'electron-custom-start',
    configResolved(config) {
      const index = config.plugins.findIndex(p => p.name === 'electron-main-watcher')
        // At present, Vite can only modify plugins in configResolved hook.
        ; (config.plugins as Plugin[]).splice(index, 1)
    },
    closeBundle() {
      onstart?.()
    },
  }
}

export async function bootstrap(config: Configuration, server: ViteDevServer) {
  const electronPath = require('electron')
  const { config: viteConfig } = server

  // ---- Electron-Preload ----
  if (config.preload) {
    const preloadRuntime = resolveRuntime('preload', config, viteConfig)
    const preloadConfig = mergeConfig(
      {
        build: {
          watch: {},
        },
        plugins: [{
          name: 'electron-preload-watcher',
          closeBundle() {
            server.ws.send({ type: 'full-reload' })
          },
        }],
      } as UserConfig,
      resolveBuildConfig(preloadRuntime),
    ) as InlineConfig

    await viteBuild(createWithExternal(preloadRuntime)(preloadConfig))
  }

  // ---- Electron-Main ----
  const env = resolveEnv(server)
  if (env) {
    Object.assign(process.env, {
      VITE_DEV_SERVER_URL: env.url,
      VITE_DEV_SERVER_HOST: env.host,
      VITE_DEV_SERVER_PORT: env.port,
    })
  }

  const mainRuntime = resolveRuntime('main', config, viteConfig)
  const mainConfig = mergeConfig(
    {
      build: {
        watch: {},
      },
      plugins: [
        {
          name: 'electron-main-watcher',
          closeBundle() {
            if (process.electronApp) {
              process.electronApp.removeAllListeners()
              process.electronApp.kill()
            }

            // Start Electron.app
            process.electronApp = spawn(electronPath, ['.', '--no-sandbox'], { stdio: 'inherit' })
            // Exit command after Electron.app exits
            process.electronApp.once('exit', process.exit)
          },
        },
        checkPkgMain.buildElectronMainPlugin(mainRuntime),
      ],
    } as UserConfig,
    resolveBuildConfig(mainRuntime),
  ) as InlineConfig

  await viteBuild(createWithExternal(mainRuntime)(mainConfig))
}
