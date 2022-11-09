import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'

export default defineConfig({
  plugins: [
    electron({
      entry: 'electron/main.ts',
      onstart: options => {
        /** Start Electron App */
        options.startup(['.', '--no-sandbox'])
      },
    }),
  ],
})
