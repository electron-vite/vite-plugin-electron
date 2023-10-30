import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import multiple from 'vite-plugin-multiple'

export default defineConfig(() => {
  fs.rmSync(path.join(__dirname, 'dist-electron'), { recursive: true, force: true })

  return {
    plugins: [
      electron({
        entry: [
          'electron/main.ts',
          'electron/preload.ts',
        ],
      }),
      multiple([
        {
          name: 'node-true',
          config: 'vite.node-true.config.ts',
        },
        {
          name: 'node-false',
          config: 'vite.node-false.config.ts',
        },
      ]),
    ],
    build: {
      rollupOptions: {
        input: path.join(__dirname, 'html/index.html'),
      },
    },
  }
})
