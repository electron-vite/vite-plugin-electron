import fs from 'fs'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import esmodule from 'vite-plugin-esmodule'
import pkg from './package.json'

fs.rmSync('dist', { recursive: true, force: true })

export default defineConfig({
  plugins: [
    electron({
      entry: 'electron/main.ts',
    }),
    renderer({
      // Enables use of Node.js API in the Renderer-process
      nodeIntegration: true,
      // Explicitly specify external modules
      resolve: () => ['serialport', 'sqlite3'],
    }),
    // If an npm package is a pure ESM format package, 
    // and the packages it depends on are also in ESM format, 
    // then put it in `optimizeDeps.exclude` and it will work normally.
    esmodule(['execa', 'got', 'node-fetch']),
  ],
  build: {
    minify: false,
    rollupOptions: {
      external: Object.keys(pkg.dependencies),
    },
  },
  optimizeDeps: {
    // exclude: ['only-support-pure-esmodule-package'],
  },
})
