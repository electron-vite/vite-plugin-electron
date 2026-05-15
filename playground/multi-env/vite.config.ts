import { defineConfig } from 'vite'

import { electronSimple } from '../../src/multi-env'

export default defineConfig({
  build: {
    minify: false,
  },
  plugins: [
    electronSimple({
      main: {
        input: ['electron/main.ts', 'electron/worker.ts'],
        options: {
          define: {
            __PLAYGROUND_MULTI_ENV_MAIN_LABEL__: JSON.stringify('main-env-ready'),
            __PLAYGROUND_MULTI_ENV_MAIN_NAME__: JSON.stringify('electron_main'),
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        options: {
          define: {
            __PLAYGROUND_MULTI_ENV_PRELOAD_LABEL__: JSON.stringify('preload-env-ready'),
            __PLAYGROUND_MULTI_ENV_PRELOAD_NAME__: JSON.stringify('electron_preload'),
          },
        },
      },
    }),
  ],
})
