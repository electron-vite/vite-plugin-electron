import {
  type ViteDevServer,
  type UserConfig,
  build as viteBuild,
  mergeConfig,
} from 'vite'
import type { Configuration } from '.'
import {
  createWithExternal,
  resolveBuildConfig,
  resolveServerUrl,
} from './config'

/**
 * Electron App startup function
 * @param argv default value `['.', '--no-sandbox']`
 */
export async function startup(argv = ['.', '--no-sandbox']) {
  const { spawn } = await import('child_process')
  // @ts-ignore
  const electronPath = (await import('electron')).default as string

  if (process.electronApp) {
    process.electronApp.removeAllListeners()
    process.electronApp.kill()
  }

  // Start Electron.app
  process.electronApp = spawn(electronPath, argv, { stdio: 'inherit' })
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
              config.onstart.call(this, {
                startup,
                reload() {
                  server.ws.send({ type: 'full-reload' })
                },
              })
            } else {
              // TODO: 2022-10-12 Rollup can't accurately distinguish a file with multiple entries
              if (false/* path.parse(filename).name.endsWith('reload') */) {
                // Bundle filename that ends with `reload` will trigger the Electron-Renderer process to reload, 
                // instead of restarting the entire Electron App.
                // e.g.
                //   dist/electron/preload.ts
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
