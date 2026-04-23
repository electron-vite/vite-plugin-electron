import fs from 'node:fs/promises'
import path from 'node:path'

import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

import electron from '../../src/index'

const RENDERER_STATUS_VIRTUAL_ID = 'virtual:playground-flat/renderer-status'
const RESOLVED_RENDERER_STATUS_VIRTUAL_ID = `\0${RENDERER_STATUS_VIRTUAL_ID}`
const MAIN_STATUS_VIRTUAL_ID = 'virtual:playground-flat/main-status'
const RESOLVED_MAIN_STATUS_VIRTUAL_ID = `\0${MAIN_STATUS_VIRTUAL_ID}`

function createRendererStatusPlugin(status: string): Plugin {
  let resolvedStatus = status

  return {
    name: `playground-flat:renderer-${status}`,
    configResolved() {
      resolvedStatus = `${status}-resolved`
    },
    resolveId(id) {
      if (id === RENDERER_STATUS_VIRTUAL_ID) {
        return RESOLVED_RENDERER_STATUS_VIRTUAL_ID
      }
    },
    load(id) {
      if (id !== RESOLVED_RENDERER_STATUS_VIRTUAL_ID) {
        return
      }

      if (status !== 'override') {
        return
      }

      return `export const rendererLoadedStatus = ${JSON.stringify(resolvedStatus)}`
    },
    transform(code, id) {
      if (status !== 'override') {
        return
      }

      const normalizedId = id.replaceAll('\\', '/')
      if (!normalizedId.endsWith('/src/main.ts')) {
        return
      }

      return code.replace(
        /\b__FLAT_RENDERER_TRANSFORM_STATUS__\b/,
        JSON.stringify(`renderer-${status}-transform`),
      )
    },
    config() {
      return {
        define: {
          __FLAT_RENDERER_STATUS__: JSON.stringify(status),
        },
      }
    },
    async closeBundle() {
      if (status !== 'override') {
        return
      }

      const outDir = path.resolve(
        this.environment.config.root,
        this.environment.config.build.outDir,
      )
      await fs.writeFile(
        path.join(outDir, 'renderer-close-bundle.txt'),
        `${status}:${this.environment.name}`,
        'utf-8',
      )
    },
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
  let resolvedStatus = status

  return {
    name: `playground-flat:main-${status}`,
    configResolved() {
      resolvedStatus = `${status}-resolved`
    },
    resolveId(id) {
      if (id === MAIN_STATUS_VIRTUAL_ID) {
        return RESOLVED_MAIN_STATUS_VIRTUAL_ID
      }
    },
    load(id) {
      if (id !== RESOLVED_MAIN_STATUS_VIRTUAL_ID) {
        return
      }

      if (status !== 'override') {
        return
      }

      return `export const mainLoadedStatus = ${JSON.stringify(resolvedStatus)}`
    },
    transform(code, id) {
      if (status !== 'override') {
        return
      }

      const normalizedId = id.replaceAll('\\', '/')
      if (!normalizedId.endsWith('/electron/main.ts')) {
        return
      }

      return code.replace(
        /\b__FLAT_MAIN_TRANSFORM_STATUS__\b/,
        JSON.stringify(`main-${status}-transform`),
      )
    },
    config() {
      return {
        define: {
          // fixme)) not working
          __FLAT_MAIN_STATUS__: JSON.stringify(status),
        },
      }
    },
    configEnvironment() {
      return {
        define: {
          // fixme)) not working
          __FLAT_MAIN_ENV_STATUS__: JSON.stringify(status),
        },
      }
    },
    async closeBundle() {
      if (status !== 'override') {
        return
      }

      const outDir = path.resolve(
        this.environment.config.root,
        this.environment.config.build.outDir,
      )
      await fs.writeFile(
        path.join(outDir, 'main-close-bundle.txt'),
        `${status}:${this.environment.name}`,
        'utf-8',
      )
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
