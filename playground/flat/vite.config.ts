import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

import electron from '../../src/index'

function createRendererStatusPlugin(status: string): Plugin {
  return {
    name: `playground-flat:renderer-${status}`,
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'script',
            injectTo: 'head',
            children: `window.__flatRendererStatus = ${JSON.stringify(status)}`,
          },
        ],
      }
    },
  }
}

function createMainStatusPlugin(status: string): Plugin {
  return {
    name: `playground-flat:main-${status}`,
    config() {
      return {
        define: {
          __FLAT_MAIN_STATUS__: JSON.stringify(status),
        },
      }
    },
  }
}

export default defineConfig({
  build: {
    minify: false,
  },
  plugins: [
    createRendererStatusPlugin('base'),
    createRendererStatusPlugin('override'),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          plugins: [createMainStatusPlugin('base'), createMainStatusPlugin('override')],
        },
      },
    ]),
  ],
})
