import {
  type Plugin,
  type ViteDevServer,
  type UserConfig,
  build as viteBuild,
  mergeConfig,
} from 'vite'
import type { PluginContext } from 'rollup'
import type { Configuration } from './types'
import {
  createWithExternal,
  resolveBuildConfig,
  resolveEnv,
} from './config'

/**
 * Custom start plugin
 */
export function onstart(onstart?: (this: PluginContext, startup_fn: typeof startup) => void): Plugin {
  return {
    name: ':onstart',
    configResolved(config) {
      const index = config.plugins.findIndex(p => p.name === ':startup')
        // At present, Vite can only modify plugins in configResolved hook.
        ; (config.plugins as Plugin[]).splice(index, 1)
    },
    closeBundle() {
      onstart?.call(this, startup)
    },
  }
}

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
    VITE_DEV_SERVER_URL: resolveEnv(server)?.url
  })
  const { config: resolved } = server

  for (const config of configArray) {
    const withExternal = createWithExternal(config, resolved)
    const inlineConfig = withExternal(resolveBuildConfig(config, resolved))
    await viteBuild(mergeConfig(
      {
        build: {
          watch: {},
        },
        plugins: [{
          name: ':startup',
          closeBundle() {
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
          },
        }],
      } as UserConfig,
      inlineConfig,
    ))
  }
}
