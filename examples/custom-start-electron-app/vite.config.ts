import fs from 'fs'
import { defineConfig } from 'vite'
import electron, { onstart } from 'vite-plugin-electron'

fs.rmSync('dist', { recursive: true, force: true })
const cmds = process.argv.slice(2)
const isdev = !cmds.length || cmds.includes('dev') || cmds.includes('serve')

export default defineConfig({
  plugins: [
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          plugins: [isdev && onstart(startup => {
            /** Start Electron App */
            startup()
          })],
        },
      },
    }),
  ],
})
