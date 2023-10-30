import { createRequire } from 'node:module'
import type {
  Plugin,
  ResolveFn,
} from 'vite'

export interface NotBundleOptions {
  filter?: (id: string) => void | false
}

/**
 * @see https://github.com/vitejs/vite/blob/v4.4.7/packages/vite/src/node/utils.ts#L140
 */
export const bareImportRE = /^(?![a-zA-Z]:)[\w@](?!.*:\/\/)/

/**
 * During dev, we exclude the `cjs` npm-pkg from bundle, mush like Vite :)
 */
export function notBundle(options: NotBundleOptions = {}): Plugin {
  let resolve: ResolveFn
  const ids = new Map<string, string>()

  return {
    name: 'vite-plugin-electron:not-bundle',
    // Run before the builtin plugin 'vite:resolve'
    enforce: 'pre',
    configResolved(config) {
      resolve = config.createResolver({ asSrc: false })
    },
    async resolveId(source, importer) {
      if (!importer) return // entry file

      const external = {
        external: true,
        id: source,
      }

      if (ids.get(source)) {
        return external
      }

      if (bareImportRE.test(source)) {
        const isAlias = await resolve(source, importer, true)
        if (isAlias) return

        const id = await resolve(source, importer)
        if (!id) return
        if (!id.includes('/node_modules/')) return
        if (options.filter?.(id) === false) return

        try {
          // Because we build Main process into `cjs`, so a npm-pkg can be loaded by `require()`.
          createRequire(importer)(source)
        } catch {
          return
        }

        ids.set(source, id)
        return external
      }
    },
  }
}
