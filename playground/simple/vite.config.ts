import { defineConfig } from 'vite'

import electronSimple from '../../src/simple'

export default defineConfig({
  build: {
    minify: false,
  },
  plugins: [
    electronSimple({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
})
