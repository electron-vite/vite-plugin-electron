import { builtinModules } from 'node:module'

import { createBuilder, mergeConfig, version } from 'vite'
import type { EnvironmentOptions, Plugin } from 'vite'

import { loadPackageJSON } from 'local-pkg'

import type { RolldownOptions } from './utils'
import { resolveInput, resolveServerUrl, setupMockHtml, withExternalBuiltins } from './utils'
import { startup } from './legacy'

// public utils
export { startup, withExternalBuiltins }
export { loadPackageJSON, loadPackageJSONSync } from 'local-pkg'

export interface OnstartArgs {
  /**
   * Electron App startup function.
   * It will mount the Electron App child-process to `process.electronApp`.
   * @param argv default value `['.', '--no-sandbox']`
   * @param options options for `child_process.spawn`
   * @param customElectronPkg custom electron package name (default: 'electron')
   */
  startup: typeof startup
  /** Reload Electron-Renderer */
  reload: () => void
}

export interface ElectronSimpleOptions {
  main: {
    /** Shortcut of `build.lib.entry` */
    entry: import('vite').LibraryOptions['entry']
    /** Additional Vite environment options for the main process */
    vite?: EnvironmentOptions
    /**
     * Triggered when Vite builds the main process -- `vite serve` command only.
     *
     * If this `onstart` is passed, Electron App will not start automatically.
     * However, you can start Electron App via `startup` function.
     */
    onstart?: (args: OnstartArgs) => void | Promise<void>
  }
  preload?: {
    /**
     * Shortcut of `build.rolldownOptions.input`.
     *
     * Preload scripts may contain Web assets, so use `build.rolldownOptions.input`
     * instead of `build.lib.entry`.
     */
    input: RolldownOptions['input']
    /** Additional Vite environment options for the preload scripts */
    vite?: EnvironmentOptions
    /**
     * Triggered when Vite builds the preload scripts -- `vite serve` command only.
     * Defaults to reloading the renderer.
     */
    onstart?: (args: OnstartArgs) => void | Promise<void>
  }
  /**
   * Support use Node.js API in Electron-Renderer.
   * @see https://github.com/electron-vite/vite-plugin-electron-renderer
   */
  renderer?: import('vite-plugin-electron-renderer').RendererOptions
}

function getBuiltins(): string[] {
  const builtins = builtinModules.filter((e) => !e.startsWith('_'))
  builtins.push('electron', ...builtins.map((m) => `node:${m}`))
  return builtins
}

/**
 * Simple Electron plugin for Vite using the environment API.
 *
 * Configures the Electron main process and preload scripts as named Vite
 * environments (`electron-main`, `electron-preload`), so they are built as
 * part of the same Vite pipeline instead of spawning separate `vite.build()`
 * processes.
 */
export default async function electronSimple(options: ElectronSimpleOptions): Promise<Plugin[]> {
  if (!version.startsWith('8.')) {
    throw new Error(
      `[vite-plugin-electron] Vite v${version} does not support \`rolldownOptions\`, please install \`vite@>=8\` or use an earlier version of \`vite-plugin-electron\`.`,
    )
  }

  const packageJson = (await loadPackageJSON()) ?? {}
  const esmodule = packageJson.type === 'module'
  const builtins = getBuiltins()

  /** Build the EnvironmentOptions for the Electron main process. */
  function makeMainEnv(isDev: boolean): EnvironmentOptions {
    return mergeConfig(
      {
        consumer: 'server',
        keepProcessEnv: true,
        build: {
          lib: {
            entry: options.main.entry,
            formats: esmodule ? ['es'] : ['cjs'],
            fileName: () => '[name].js',
          },
          outDir: 'dist-electron',
          emptyOutDir: false,
          minify: isDev ? false : undefined,
          watch: isDev ? {} : null,
          rolldownOptions: {
            platform: 'node',
            external: builtins,
          },
        },
      } as EnvironmentOptions,
      options.main.vite ?? {},
    )
  }

  /** Build the EnvironmentOptions for the Electron preload scripts. */
  function makePreloadEnv(isDev: boolean): EnvironmentOptions | null {
    if (!options.preload) return null
    const { input, vite: preloadVite = {} } = options.preload
    return mergeConfig(
      {
        consumer: 'server',
        keepProcessEnv: true,
        build: {
          rolldownOptions: {
            // `rolldownOptions.input` has higher priority than `build.lib`.
            input,
            platform: 'node',
            output: {
              // In most cases, use `cjs` format
              format: 'cjs',
              // `require()` can usable matrix
              //  @see - https://github.com/electron/electron/blob/v30.0.0-nightly.20240104/docs/tutorial/esm.md#preload-scripts
              //  ┏———————————————————————————————————┳——————————┳———————————┓
              //  │ webPreferences: { }               │  import  │  require  │
              //  ┠———————————————————————————————————╂——————————╂———————————┨
              //  │ nodeIntegration: false(undefined) │    ✘     │     ✔     │
              //  ┠———————————————————————————————————╂——————————╂———————————┨
              //  │ nodeIntegration: true             │    ✔     │     ✔     │
              //  ┠———————————————————————————————————╂——————————╂———————————┨
              //  │ sandbox: true(undefined)          │    ✘     │     ✔     │
              //  ┠———————————————————————————————————╂——————————╂———————————┨
              //  │ sandbox: false                    │    ✔     │     ✘     │
              //  ┠———————————————————————————————————╂——————————╂———————————┨
              //  │ nodeIntegration: false            │    ✘     │     ✔     │
              //  │ sandbox: true                     │          │           │
              //  ┠———————————————————————————————————╂——————————╂———————————┨
              //  │ nodeIntegration: false            │    ✔     │     ✘     │
              //  │ sandbox: false                    │          │           │
              //  ┠———————————————————————————————————╂——————————╂———————————┨
              //  │ nodeIntegration: true             │    ✘     │     ✔     │
              //  │ sandbox: true                     │          │           │
              //  ┠———————————————————————————————————╂——————————╂———————————┨
              //  │ nodeIntegration: true             │    ✔     │     ✔     │
              //  │ sandbox: false                    │          │           │
              //  ┗———————————————————————————————————┸——————————┸———————————┛
              //  - import(✘): SyntaxError: Cannot use import statement outside a module
              //  - require(✘): ReferenceError: require is not defined in ES module scope
              inlineDynamicImports: true,
              entryFileNames: `[name].${esmodule ? 'mjs' : 'js'}`,
              chunkFileNames: `[name].${esmodule ? 'mjs' : 'js'}`,
              assetFileNames: '[name].[ext]',
            },
            external: builtins,
          },
          outDir: 'dist-electron',
          emptyOutDir: false,
          minify: isDev ? false : undefined,
          watch: isDev ? {} : null,
        },
      } as EnvironmentOptions,
      preloadVite,
    )
  }

  let cleanupMock: (() => Promise<void>) | undefined

  const plugins: Plugin[] = [
    {
      name: 'vite-plugin-electron',

      config(userConfig, { command }) {
        const isDev = command === 'serve'

        const environments: Record<string, EnvironmentOptions> = {
          'electron-main': makeMainEnv(isDev),
        }
        const preloadEnv = makePreloadEnv(isDev)
        if (preloadEnv) {
          environments['electron-preload'] = preloadEnv
        }

        return {
          // Make sure that Electron can be loaded from a local file using `loadFile` after packaging.
          base: './',
          environments,
          // Opt into the Vite builder so all environments are built in one pipeline.
          builder: {},
        }
      },

      configResolved(config) {
        // When there is no entry (no index.html and no configured input), write a
        // temporary mock so that Vite has a valid entry point.
        if (!resolveInput(config)) {
          cleanupMock = setupMockHtml(config, config.command === 'build', config.logger)
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

          // Why not use Vite's built-in `/@vite/client` to implement Hot reload?
          // Because Vite only inserts `/@vite/client` into the `*.html` entry file;
          // preload scripts are usually a `*.js` file.
          // @see - https://github.com/vitejs/vite/blob/v5.2.11/packages/vite/src/node/server/middlewares/indexHtml.ts#L399
          const reload = () => {
            if (process.electronApp) {
              ;(server.hot || server.ws).send({ type: 'full-reload' })
              // For Electron apps that don't use the renderer process.
              startup.send('electron-vite&type=hot-reload')
            } else {
              startup()
            }
          }

          // Coordinate startup: start Electron only after all environments
          // complete their initial build (main + preload must both be ready).
          const hasPreload = !!options.preload
          const totalInitial = hasPreload ? 2 : 1
          let initialCount = 0
          let electronStarted = false

          // Use the environment API (createBuilder) to build and watch the
          // Electron environments instead of calling vite.build() separately.
          const builder = await createBuilder({
            configFile: false,
            root: server.config.root,
            mode: server.config.mode,
            envDir: server.config.envDir,
            envPrefix: server.config.envPrefix,
            logLevel: server.config.logLevel,
            plugins: [
              {
                name: 'vite-plugin-electron:lifecycle',
                closeBundle() {
                  const envName = this.environment?.name

                  if (envName !== 'electron-main' && envName !== 'electron-preload') return

                  if (!electronStarted) {
                    // Wait for all environments to complete their initial build.
                    initialCount++
                    if (initialCount >= totalInitial) {
                      electronStarted = true
                      if (options.main.onstart) {
                        options.main.onstart({ startup, reload })
                      } else {
                        startup()
                      }
                    }
                  } else {
                    // Subsequent watch rebuilds.
                    if (envName === 'electron-main') {
                      if (options.main.onstart) {
                        options.main.onstart({ startup, reload })
                      } else {
                        startup()
                      }
                    } else {
                      // electron-preload
                      if (options.preload?.onstart) {
                        options.preload.onstart({ startup, reload })
                      } else {
                        reload()
                      }
                    }
                  }
                },
              },
            ],
            // Define the electron environments with watch mode enabled.
            environments: {
              'electron-main': makeMainEnv(true),
              ...(options.preload ? { 'electron-preload': makePreloadEnv(true)! } : {}),
            },
          })

          // Kick off watch builds for all electron environments.
          for (const env of Object.values(builder.environments)) {
            if (env.name !== 'client') {
              builder.build(env)
            }
          }
        })
      },

      async closeBundle() {
        // During `vite build`, clean up the mock entry only after the client
        // environment finishes; the electron environments are built automatically
        // by the Vite builder pipeline.
        if (this.environment?.name !== 'client') return

        if (cleanupMock) {
          await cleanupMock()
          cleanupMock = undefined
        }
      },
    },
  ]

  if (options.renderer) {
    try {
      const renderer = await import('vite-plugin-electron-renderer')
      plugins.push(renderer.default(options.renderer))
    } catch (error: any) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          `\`renderer\` option depends on "vite-plugin-electron-renderer". Did you install it? Try \`npm i -D vite-plugin-electron-renderer\`.`,
        )
      }

      throw error
    }
  }

  return plugins
}
