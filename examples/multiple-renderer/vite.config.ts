import path from 'node:path'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'

export default defineConfig({
  plugins: [
    electron({
      entry: [
        'electron/main.ts',
        'electron/preload.ts',
      ],
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        index: path.join(__dirname, 'html/index.html'),
        foo: path.join(__dirname, 'html/foo.html'),
        bar: path.join(__dirname, 'html/bar.html'),
      },
    },
  },
})
