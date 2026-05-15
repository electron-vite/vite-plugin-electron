import { loadPackageJSONSync } from 'local-pkg'
import type { Plugin } from 'vite'

import type { RolldownOptions } from './utils'

export interface NotBundleOptions {
  /**
   * Manually override of `build.rollupOptions.external`.
   */
  filter?: RolldownOptions['external']
}

/**
 * @see https://github.com/vitejs/vite/blob/v4.4.7/packages/vite/src/node/utils.ts#L140
 */
export const bareImportRE: RegExp = /^(?![a-zA-Z]:)[\w@](?!.*:\/\/)/

/**
 * During dev, we exclude the `cjs` npm-pkg from bundle, mush like Vite :)
 */
export function notBundle(options: NotBundleOptions = {}): Plugin {
  return {
    name: 'vite-plugin-electron:not-bundle',
    // Run before the builtin plugin 'vite:resolve'
    enforce: 'pre',
    config(cfg) {
      let external: RolldownOptions['external']
      if (!options.filter) {
        const pkg = loadPackageJSONSync(cfg.root)
        if (pkg) {
          external = Object.keys({
            ...pkg.dependencies,
            ...pkg.devDependencies,
            ...pkg.peerDependencies,
            ...pkg.optionalDependencies,
          })
        } else {
          console.warn(
            '[vite-plugin-electron:not-bundle] No package.json found in the project root and no filter option provided. All dependencies will be bundled.',
          )
          external = []
        }
      } else {
        external = options.filter
      }
      return {
        build: {
          rolldownOptions: {
            external,
          },
        },
      }
    },
  }
}
