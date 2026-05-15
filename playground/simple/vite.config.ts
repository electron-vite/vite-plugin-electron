import { defineConfig } from 'vite'

import { notBundle } from '../../src/plugin'
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
          plugins: [notBundle()],
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
})
