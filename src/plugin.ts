import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'
import { resolveInput } from './utils'

export interface NotBundleOptions {
  filter?: (id: string) => void | boolean
}

const MOCK_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>vite-plugin-electron</title>
  </head>
  <body>
    <div>An entry file for electron renderer process.</div>
  </body>
</html>`

/**
 * When `vite build` runs without any entry configured and without a real
 * `index.html`, create a temporary one so Vite has a valid entry point.
 * The mock files are removed in `closeBundle` once the build is complete.
 *
 * @see https://vitejs.dev/guide/build#library-mode
 */
export function mockHtml(): Plugin {
  let mockFilepath: string | undefined
  let distFilepath: string | undefined

  return {
    name: 'vite-plugin-electron:mock-html',
    apply: 'build',

    async configResolved(config: ResolvedConfig) {
      if (resolveInput(config) == null) {
        const { root, build } = config
        mockFilepath = path.join(root, 'index.html')
        distFilepath = path.resolve(root, build.outDir, 'index.html')
        await fs.promises.writeFile(mockFilepath, MOCK_INDEX_HTML)
      }
    },

    closeBundle: {
      sequential: true,
      async handler() {
        if (mockFilepath) {
          // The file might already be gone if the build failed before writing it.
          await fs.promises.unlink(mockFilepath).catch(() => {})
          mockFilepath = undefined
        }
        if (distFilepath) {
          // Vite may skip writing this file (e.g. when the build is aborted),
          // so silently ignore the error if it does not exist.
          await fs.promises.unlink(distFilepath).catch(() => {})
          distFilepath = undefined
        }
      },
    },
  }
}

/**
 * @see https://github.com/vitejs/vite/blob/v4.4.7/packages/vite/src/node/utils.ts#L140
 */
export const bareImportRE: RegExp = /^(?![a-zA-Z]:)[\w@](?!.*:\/\/)/
const nodeModulesRE: RegExp = /\/node_modules\//

/**
 * During dev, we exclude the `cjs` npm-pkg from bundle, mush like Vite :)
 */
export function notBundle(options: NotBundleOptions = {}): Plugin {
  const externalIds = new Set<string>()

  return {
    name: 'vite-plugin-electron:not-bundle',
    // Run before the builtin plugin 'vite:resolve'
    enforce: 'pre',
    apply: 'serve',

    resolveId: {
      filter: {
        id: bareImportRE,
      },
      async handler(source, importer) {
        if (!importer || importer.includes('node_modules/')) return
        if (externalIds.has(source)) {
          return { id: source, external: true }
        }

        const resolved = await this.resolve(source, importer, {
          skipSelf: true
        })
        
        const id = resolved?.id
        if (!id || !nodeModulesRE.test(id) || options.filter?.(id) === false) return

        try {
          // Because we build Main process into `cjs`, so a npm-pkg can be loaded by `require()`.
          createRequire(importer).resolve(source)
        } catch {
          return
        }

        externalIds.add(source)
        
        return { 
          id: source, 
          external: true,
          moduleSideEffects: false
        }
      }
    }
  }
}