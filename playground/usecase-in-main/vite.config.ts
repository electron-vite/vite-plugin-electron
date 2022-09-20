import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { defineConfig } from 'vite'
import electron, { onstart } from 'vite-plugin-electron'
import electronPath from 'electron'

fs.rmSync('dist', { recursive: true, force: true })

export default defineConfig({
  plugins: [
    electron({
      main: {
        entry: 'electron/main/index.ts',
        vite: {
          build: {
            outDir: 'dist/electron/main',
            minify: false,
          },
          plugins: [
            // Custom start Electron
            onstart(() => {
              if (process.electronApp) {
                process.electronApp.removeAllListeners()
                process.electronApp.kill()
              }
  
              // Start Electron.app
              process.electronApp = spawn(electronPath, ['.', '--no-sandbox'], { stdio: 'inherit' })
              // Exit command after Electron.app exits
              process.electronApp.once('exit', process.exit)
            }),
          ],
        },
      },
      preload: {
        input: {
          // You can configure multiple preload here
          index: path.join(__dirname, 'electron/preload/index.ts'),
        },
        vite: {
          build: {
            // For debug
            sourcemap: 'inline',
            outDir: 'dist/electron/preload',
            minify: false,
          },
        },
      },
      worker: {
        input: {
          // You can configure multiple worker here
          task1: path.join(__dirname, 'electron/worker/task1.ts'),
        },
        vite: {
          build: {
            // For debug
            sourcemap: 'inline',
            outDir: 'dist/electron/worker',
            minify: false,
          },
        },
      },
    }),
  ],
  build: {
    minify: false,
  },
})
