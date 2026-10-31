import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

import electron, { startup } from '../../src/index'

// Kill the helper (and anything else the app started) when Electron exits by itself.
// SHUTDOWN_TREE_KILL=0 shows the unhandled behavior: on Windows, Electron hangs after quitting.
startup.treeKill = process.env.SHUTDOWN_TREE_KILL !== '0'

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
            // `entry` only selects what is built; the default startup would launch `.` (the
            // first app) again, so start this plugin's own build explicitly.
            onstart({ startup }) {
              return void startup(['dist-electron/second.js', '--no-sandbox'])
            },
          }),
        ]
      : []),
  ],
})
