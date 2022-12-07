import {
  type Plugin,
  defineConfig,
  loadEnv,
} from 'vite'
import electron from 'vite-plugin-electron'

// Load .env
function loadEnvPlugin(): Plugin {
  return {
    name: 'vite-plugin-load-env',
    config(config, env) {
      const root = config.root ?? process.cwd()
      const result = loadEnv(env.mode, root)
      // Remove the vite-plugin-electron injected env.
      delete result.VITE_DEV_SERVER_URL
      config.esbuild ??= {}
      config.esbuild.define = {
        ...config.esbuild.define,
        ...Object.fromEntries(Object.entries(result)
          .map(([key, val]) => [`process.env.${key}`, JSON.stringify(val)])),
      }
    },
  }
}

export default defineConfig({
  plugins: [
    electron([
      {
        // Main-Process entry file of the Electron App.
        entry: 'electron/main.ts',
        vite: {
          plugins: [loadEnvPlugin()],
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete, 
          // instead of restarting the entire Electron App.
          options.reload()
        },
      },
    ]),
  ],
})
