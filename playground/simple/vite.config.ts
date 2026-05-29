import { defineConfig } from 'vite'

import { esmShim, notBundle } from '../../src/plugin'
import electronSimple from '../../src/simple'

export default defineConfig({
  build: {
    minify: false,
  },
  plugins: [
    electronSimple({
      main: {
        entry: 'electron/main.ts',
        vite: {
          plugins: [notBundle(), esmShim()],
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
})
