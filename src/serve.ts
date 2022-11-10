import {
  type ViteDevServer,
  type UserConfig,
  build as viteBuild,
  mergeConfig,
} from 'vite'
import {
  type Configuration,
  startup,
} from '.'
import {
  resolveServerUrl,
  resolveViteConfig,
  withExternalBuiltins,
} from './config'

/** Work on the `vite serve` command */
export async function bootstrap(config: Configuration | Configuration[], server: ViteDevServer) {
  Object.assign(process.env, {
    VITE_DEV_SERVER_URL: resolveServerUrl(server)
  })

  const configArray = Array.isArray(config) ? config : [config]

  for (const config of configArray) {
    const inlineConfig = withExternalBuiltins(resolveViteConfig(config))
    await viteBuild(mergeConfig(
      {
        mode: 'development',
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
