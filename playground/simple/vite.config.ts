import { defineConfig } from 'vite'

import { esmShim, notBundle } from '../../src/plugin'
import electronSimple from '../../src/simple'

export default defineConfig(({ command }) => ({
  build: {
    minify: false,
  },
  plugins: [
    electronSimple({
      main: {
        entry: 'electron/main.ts',
        vite: {
          plugins: [command === 'serve' && notBundle(), esmShim()],
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
}))
