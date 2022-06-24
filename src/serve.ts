import path from 'path'
import { spawn } from 'child_process'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import type { AddressInfo } from 'net'
import type { ViteDevServer, UserConfig, InlineConfig } from 'vite'
import { build as viteBuild, mergeConfig } from 'vite'
import { resolveBuildConfig } from './build'
import type { Configuration } from './types'

export async function bootstrap(config: Configuration, server: ViteDevServer) {
  const electronPath = require('electron')
  const { config: viteConfig } = server

  if (config.preload) {
    const preloadConfig = mergeConfig(
      resolveBuildConfig('preload', config, viteConfig),
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

    await viteBuild(preloadConfig)
  }

  // ----------------------------------------------------------------

  let electronProcess: ChildProcessWithoutNullStreams = null
  const address = server.httpServer.address() as AddressInfo
  const env = Object.assign(process.env, {
    VITE_DEV_SERVER_HOST: address.address,
    VITE_DEV_SERVER_PORT: address.port,
  })

  const mainConfig = mergeConfig(
    resolveBuildConfig('main', config, viteConfig),
    {
      mode: 'development',
      build: {
        watch: true,
      },
      plugins: [{
        name: 'electron-main-watcher',
        writeBundle() {
          if (electronProcess) {
            electronProcess.removeAllListeners()
            electronProcess.kill()
          }

          // TODO: Check `package.json` whether the `main` entry in JOSN is correct
          // Start Electron.app
          electronProcess = spawn(electronPath, ['.'], { stdio: 'inherit', env })
          // Exit command after Electron.app exits
          electronProcess.once('exit', process.exit)
        },
      }],
    } as UserConfig,
  ) as InlineConfig

  await viteBuild(mainConfig)
}
