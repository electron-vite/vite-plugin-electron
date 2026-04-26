import { defineConfig } from 'vite'

import electron from '../../src/multi-env'

export default defineConfig({
  build: {
    minify: false,
  },
  plugins: [
    electron([
      {
        name: 'main',
        input: 'electron/main.ts',
        options: {
          define: {
            __PLAYGROUND_MULTI_ENV_MAIN_LABEL__: JSON.stringify('main-env-ready'),
            __PLAYGROUND_MULTI_ENV_MAIN_NAME__: JSON.stringify('electron_main'),
          },
          build: {
            minify: false,
            outDir: 'dist-electron',
          },
        },
      },
      {
        name: 'preload',
        input: 'electron/preload.ts',
        onstart({ reload }) {
          reload()
        },
        options: {
          define: {
            __PLAYGROUND_MULTI_ENV_PRELOAD_LABEL__: JSON.stringify('preload-env-ready'),
            __PLAYGROUND_MULTI_ENV_PRELOAD_NAME__: JSON.stringify('electron_preload'),
          },
          build: {
            minify: false,
            outDir: 'dist-electron',
            rolldownOptions: {
              output: {
                format: 'cjs',
                codeSplitting: false,
                entryFileNames: '[name].js',
                chunkFileNames: '[name].js',
                assetFileNames: '[name].[ext]',
              },
            },
          },
        },
      },
    ]),
  ],
})
