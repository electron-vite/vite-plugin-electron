import fs from 'fs'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'

fs.rmSync('dist', { recursive: true, force: true })
const cmds = process.argv.slice(2)
const isdev = !cmds.length || cmds.includes('dev') || cmds.includes('serve')

export default defineConfig({
  plugins: [
    electron({
      entry: 'electron/main.ts',
      onstart: isdev ? startup => {
        /** Start Electron App */
        startup(['.', '--no-sandbox'])
      } : undefined,
    }),
  ],
})
