import {
  type Plugin,
  build as viteBuild,
} from 'vite'
import {
  type Configuration,
  resolveServerUrl,
  resolveViteConfig,
  withExternalBuiltins,
} from './config'

// public
export {
  type Configuration,
  defineConfig,
  resolveViteConfig,
  withExternalBuiltins,
} from './config'

export function build(config: Configuration) {
  return viteBuild(withExternalBuiltins(resolveViteConfig(config)))
}

export default function electron(config: Configuration | Configuration[]): Plugin[] {
  const configArray = Array.isArray(config) ? config : [config]
  let mode: string

  return [
    {
      name: 'vite-plugin-electron',
      apply: 'serve',
      configureServer(server) {
        server.httpServer?.once('listening', () => {
          Object.assign(process.env, {
            VITE_DEV_SERVER_URL: resolveServerUrl(server),
          })
          for (const config of configArray) {
            config.vite ??= {}
            config.vite.mode ??= server.config.mode
            config.vite.build ??= {}
            config.vite.build.watch ??= {}
            config.vite.plugins ??= []
            config.vite.plugins.push({
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
                  startup()
                }
              },
            })
            build(config)
          }
        })
      },
    },
    {
      name: 'vite-plugin-electron',
      apply: 'build',
      config(config, env) {
        // Make sure that Electron can be loaded into the local file using `loadFile` after packaging.
        config.base ??= './'
        mode = env.mode
      },
      async closeBundle() {
        for (const config of configArray) {
          config.vite ??= {}
          config.vite.mode ??= mode
          await build(config)
        }
      }
    },
  ]
}

/**
 * Electron App startup function.  
 * It will mount the Electron App child-process to `process.electronApp`.  
 * @param argv default value `['.', '--no-sandbox']`
 */
export async function startup(argv = ['.', '--no-sandbox']) {
  const { spawn } = await import('node:child_process')
  // @ts-ignore
  const electron = await import('electron')
  const electronPath = <any>(electron.default ?? electron)

  startup.exit()
  // Start Electron.app
  process.electronApp = spawn(electronPath, argv, { stdio: 'inherit' })
  // Exit command after Electron.app exits
  process.electronApp.once('exit', process.exit)

  if (!startup.hookProcessExit) {
    startup.hookProcessExit = true
    process.once('exit', startup.exit)
  }
}
startup.hookProcessExit = false
startup.exit = () => {
  if (process.electronApp) {
    process.electronApp.removeAllListeners()
    process.electronApp.kill()
  }
}
