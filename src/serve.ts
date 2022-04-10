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
          electronProcess && electronProcess.kill()

          // TODO: Check if electronEntry is a directory
          let electronEntry = path.join(mainConfig.build.outDir, path.parse(config.main.entry).name)
          // Start Electron App
          electronProcess = spawn(electronPath, [electronEntry], { stdio: 'inherit', env })
        },
      }],
    } as UserConfig,
  ) as InlineConfig

  await viteBuild(mainConfig)
}
