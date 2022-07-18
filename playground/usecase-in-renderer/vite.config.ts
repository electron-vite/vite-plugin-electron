import path from 'path'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import esmodule from 'vite-plugin-esmodule'

export default defineConfig({
  plugins: [
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Enables use of Node.js API in the Renderer-process
      renderer: {},
    }),
    esmodule(),
  ]
})
