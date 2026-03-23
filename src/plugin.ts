import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

export interface NotBundleOptions {
  filter?: (id: string) => void | boolean
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