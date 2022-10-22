import fs from 'fs'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'

fs.rmSync('dist', { recursive: true, force: true })

export default defineConfig({
  plugins: [
    electron([
      { entry: 'electron/main.ts' },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
      },
    ]),
  ],
})
