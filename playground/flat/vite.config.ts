import { defineConfig } from 'vite'

import electron from '../../src/index'

export default defineConfig({
  build: {
    minify: false,
  },
  plugins: [
    electron([
      {
        entry: 'electron/main.ts',
      },
    ]),
  ],
})
