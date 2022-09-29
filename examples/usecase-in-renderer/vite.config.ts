import fs from 'fs'
import path from 'path'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import esmodule from 'vite-plugin-esmodule'

fs.rmSync('dist', { recursive: true, force: true })

export default defineConfig({
  plugins: [
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            minify: false,
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            minify: false,
          },
        },
      },
      // Enables use of Node.js API in the Renderer-process
      renderer: {
        // Explicitly specify external modules
        resolve: () => [
          'serialport',
          'sqlite3',
        ],
      },
    }),
    // If an npm package is a pure ESM format package, 
    // and the packages it depends on are also in ESM format, 
    // then put it in `optimizeDeps.exclude` and it will work normally.
    esmodule(['execa', 'got', 'node-fetch']),
  ],
  build: {
    minify: false,
  },
  optimizeDeps: {
    // exclude: ['pure-esmodule-package'],
  },
})
