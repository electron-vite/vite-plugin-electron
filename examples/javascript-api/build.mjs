process.env.NODE_ENV = process.argv.includes('--watch') ? 'development' : 'production'

import { build, startup } from 'vite-plugin-electron'

const isDev = process.env.NODE_ENV === 'development'
const isProd = process.env.NODE_ENV === 'production'

build({
  entry: 'electron/main.ts',
  vite: {
    mode: process.env.NODE_ENV,
    build: {
      minify: isProd,
      watch: isDev ? {} : null,
    },
    plugins: [{
      name: 'plugin-start-electron',
      closeBundle() {
        if (isDev) {
          // Startup Electron App
          startup()
        }
      },
    }],
  },
})
