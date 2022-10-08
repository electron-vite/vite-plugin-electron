import {
  type ViteDevServer,
  type UserConfig,
  build as viteBuild,
  mergeConfig,
} from 'vite'
import type { Configuration } from './types'
import {
  createWithExternal,
  resolveBuildConfig,
  resolveServerUrl,
} from './config'

/** Electron App startup function */
export async function startup(args = ['.', '--no-sandbox']) {
  const { spawn } = await import('child_process')
  // @ts-ignore
  const electronPath = (await import('electron')).default as string

  if (process.electronApp) {
    process.electronApp.removeAllListeners()
    process.electronApp.kill()
  }

  // Start Electron.app
  process.electronApp = spawn(electronPath, args, { stdio: 'inherit' })
  // Exit command after Electron.app exits
  process.electronApp.once('exit', process.exit)
}

export async function bootstrap(configArray: Configuration[], server: ViteDevServer) {
  Object.assign(process.env, {
    VITE_DEV_SERVER_URL: resolveServerUrl(server)
  })
  const { config: resolved } = server

  for (const config of configArray) {
    const withExternal = createWithExternal(resolved.root)
    const inlineConfig = withExternal(resolveBuildConfig(config, resolved))
    await viteBuild(mergeConfig(
      {
        build: {
          watch: {},
        },
        plugins: [{
          name: ':startup',
          closeBundle() {
            if (config.onstart) {
              config.onstart.call(this, startup)
            } else {
              if (false) {
                // TODO: 2022-10-07
                // Bundle filename that end with `reload` will trigger the Electron-Renderer process to reload, 
                // instead of restarting the entire Electron App.
                // e.g.
                //   dist/electron/preload.js
                //   dist/electron/foo.reload.js
                server.ws.send({ type: 'full-reload' })
              } else {
                startup()
              }
            }
          },
        }],
      } as UserConfig,
      inlineConfig,
    ))
  }
}
