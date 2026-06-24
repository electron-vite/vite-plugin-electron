import { loadPackageJSONSync } from 'local-pkg'
import type { Plugin } from 'vite'

import { compatRollupOptions, getIsViteDev } from '../utils'
import type { RolldownOrRollupOptions } from '../utils'

export { getIsViteDev } from '../utils'

export interface NotBundleOptions {
  /**
   * Manually override of `build.rolldownOptions.external` (`build.rollupOptions.external` on Vite < 8).
   *
   * When omitted, development externalizes dependencies, devDependencies,
   * peerDependencies, and optionalDependencies from package.json.
   * Production only externalizes dependencies.
   *
   * When provided, this replaces the default package.json-derived external set.
   *
   * Use `import { getIsViteDev } from 'vite-plugin-electron/plugin'` to detect if it's during dev.
   */
  filter?: RolldownOrRollupOptions['external']
}

/**
 * Default behavior of extracting external dependencies from package.json.
 * - During development, `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies` are externalized.
 * - During production, only `dependencies` are externalized.
 * @param pkg package.json 's content
 */
export function extractExternalDeps(
  pkg: Record<string, any>,
  isDev = getIsViteDev(),
): RolldownOrRollupOptions['external'] {
  return Object.keys(
    isDev
      ? {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
          ...pkg.optionalDependencies,
        }
      : {
          ...pkg.dependencies,
        },
  )
}

/**
 * @see https://github.com/vitejs/vite/blob/v4.4.7/packages/vite/src/node/utils.ts#L140
 */
export const bareImportRE: RegExp = /^(?![a-zA-Z]:)[\w@](?!.*:\/\/)/

/**
 * During dev, we exclude the `cjs` npm-pkg from bundle, mush like Vite :)
 */
export function notBundle(options: NotBundleOptions = {}): Plugin {
  let missingPackageJsonWarning = false

  return {
    name: 'vite-plugin-electron:not-bundle',
    // Run before the builtin plugin 'vite:resolve'
    enforce: 'pre',
    config(cfg) {
      let external: RolldownOrRollupOptions['external']
      if (!options.filter) {
        const pkg = loadPackageJSONSync(cfg.root)
        if (pkg) {
          external = extractExternalDeps(pkg)
        } else {
          missingPackageJsonWarning = true
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
    configResolved(config) {
      if (missingPackageJsonWarning) {
        config.logger.warn(
          '[vite-plugin-electron:not-bundle] No package.json found in the project root and no filter option provided. All dependencies will be bundled.',
        )
      }
    },
  }
}
