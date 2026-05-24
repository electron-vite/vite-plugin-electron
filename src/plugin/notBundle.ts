import { loadPackageJSONSync } from 'local-pkg'
import type { Plugin } from 'vite'

import { compatRollupOptions } from '../utils'
import type { RolldownOrRollupOptions } from '../utils'

export interface NotBundleOptions {
  /**
   * Manually override of `build.rolldownOptions.external` (`build.rollupOptions.external` on Vite < 8).
   */
  filter?: RolldownOrRollupOptions['external']
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
      let external: RolldownOrRollupOptions['external']
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
          return
        }
      } else {
        external = options.filter
      }
      return {
        build: compatRollupOptions({
          rolldownOptions: {
            external,
          },
        }),
      }
    },
  }
}
