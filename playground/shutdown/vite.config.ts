import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

import electron from '../../src/index'

function delayWatcherClose(): Plugin {
  return {
    name: 'shutdown-playground:delay-watcher-close',
    closeWatcher() {
      const delay = Number(process.env.SHUTDOWN_WATCHER_DELAY_MS ?? 0)
      if (!delay) {
        return
      }
      console.log(`[shutdown-playground] delaying Electron watcher close by ${delay}ms before kill`)
      return new Promise((resolve) => setTimeout(resolve, delay))
    },
  }
}

const twoPlugins = process.env.SHUTDOWN_TWO_PLUGINS === '1'
const scenario = process.env.SHUTDOWN_SCENARIO ?? 'descendants'

export default defineConfig({
  build: {
    minify: false,
  },
  plugins: [
    electron({
      entry: 'electron/main.ts',
      vite: {
        plugins: [delayWatcherClose()],
      },
    }),
    ...(twoPlugins || scenario === 'two-plugins'
      ? [
          electron({
            entry: 'electron/second.ts',
          }),
        ]
      : []),
  ],
})
