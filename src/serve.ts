import { spawn } from 'child_process'
import type { AddressInfo } from 'net'
import type { ViteDevServer, UserConfig, InlineConfig } from 'vite'
import { build as viteBuild, mergeConfig } from 'vite'
import type { Configuration } from './types'
import { createWithExternal, resolveRuntime, resolveBuildConfig } from './config'

export async function bootstrap(config: Configuration, server: ViteDevServer) {
  const electronPath = require('electron')
  const { config: viteConfig } = server

  // ---- Electron-Preload ----
  if (config.preload) {
    const preloadRuntime = resolveRuntime('preload', config, viteConfig)
    const preloadConfig = mergeConfig(
      resolveBuildConfig(preloadRuntime),
      {
        mode: 'development',
        build: {
          watch: true,
        },
        plugins: [{
          name: 'electron-preload-watcher',
          writeBundle() {
            server.ws.send({ type: 'full-reload' })
          },
        }],
      } as UserConfig,
    ) as InlineConfig

    await viteBuild(createWithExternal(preloadRuntime)(preloadConfig))
  }

  // ---- Electron-Main ----
  const address = server.httpServer.address() as AddressInfo
  const env = Object.assign(process.env, {
    VITE_DEV_SERVER_HOST: address.address,
    VITE_DEV_SERVER_PORT: address.port,
  })

  const mainRuntime = resolveRuntime('main', config, viteConfig)
  const mainConfig = mergeConfig(
    resolveBuildConfig(mainRuntime),
    {
      mode: 'development',
      build: {
        watch: true,
      },
      plugins: [{
        name: 'electron-main-watcher',
        writeBundle() {
          if (process.electronApp) {
            process.electronApp.removeAllListeners()
            process.electronApp.kill()
          }

          // TODO: Check `package.json` whether the `main` entry in JOSN is correct

          // Start Electron.app
          process.electronApp = spawn(electronPath, ['.'], { stdio: 'inherit', env })
          // Exit command after Electron.app exits
          process.electronApp.once('exit', process.exit)
        },
      }],
    } as UserConfig,
  ) as InlineConfig

  await viteBuild(createWithExternal(mainRuntime)(mainConfig))
}
