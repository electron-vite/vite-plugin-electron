import type { AddressInfo } from 'node:net'
import {
  createRequire,
  builtinModules,
} from 'node:module'
import {
  type InlineConfig,
  type Plugin,
  type ResolveFn,
  type ViteDevServer,
  mergeConfig,
} from 'vite'
import type { ElectronOptions } from '.'

/** Resolve the default Vite's `InlineConfig` for build Electron-Main */
export function resolveViteConfig(options: ElectronOptions): InlineConfig {
  const defaultConfig: InlineConfig = {
    // 🚧 Avoid recursive build caused by load config file
    configFile: false,
    publicDir: false,

    build: {
      // @ts-ignore
      lib: options.entry && {
        entry: options.entry,
        // At present, Electron(20) can only support CommonJs
        formats: ['cjs'],
        fileName: () => '[name].js',
      },
      outDir: 'dist-electron',
      // Avoid multiple entries affecting each other
      emptyOutDir: false,
    },
    resolve: {
      // #136
      // Some libs like `axios` must disable the `browserField`.
      // @axios https://github.com/axios/axios/blob/v1.3.5/package.json#L129
      // @vite https://github.com/vitejs/vite/blob/v4.2.1/packages/vite/src/node/plugins/resolve.ts#L294
      browserField: false,
      // #98
      // Since we're building for electron (which uses Node.js), we don't want to use the "browser" field in the packages.
      // It corrupts bundling packages like `ws` and `isomorphic-ws`, for example.
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
  }

  return mergeConfig(defaultConfig, options?.vite || {})
}

export function withExternalBuiltins(config: InlineConfig) {
  const builtins = builtinModules.filter(e => !e.startsWith('_')); builtins.push('electron', ...builtins.map(m => `node:${m}`))

  config.build ??= {}
  config.build.rollupOptions ??= {}

  let external = config.build.rollupOptions.external
  if (
    Array.isArray(external) ||
    typeof external === 'string' ||
    external instanceof RegExp
  ) {
    external = builtins.concat(external as string[])
  } else if (typeof external === 'function') {
    const original = external
    external = function (source, importer, isResolved) {
      if (builtins.includes(source)) {
        return true
      }
      return original(source, importer, isResolved)
    }
  } else {
    external = builtins
  }
  config.build.rollupOptions.external = external

  return config
}

/**
 * @see https://github.com/vitejs/vite/blob/v4.0.1/packages/vite/src/node/constants.ts#L137-L147
 */
export function resolveHostname(hostname: string) {
  const loopbackHosts = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    '0000:0000:0000:0000:0000:0000:0000:0001',
  ])
  const wildcardHosts = new Set([
    '0.0.0.0',
    '::',
    '0000:0000:0000:0000:0000:0000:0000:0000',
  ])

  return loopbackHosts.has(hostname) || wildcardHosts.has(hostname) ? 'localhost' : hostname
}

export function resolveServerUrl(server: ViteDevServer): string | void {
  const addressInfo = server.httpServer!.address()
  const isAddressInfo = (x: any): x is AddressInfo => x?.address

  if (isAddressInfo(addressInfo)) {
    const { address, port } = addressInfo
    const hostname = resolveHostname(address)

    const options = server.config.server
    const protocol = options.https ? 'https' : 'http'
    const devBase = server.config.base

    const path = typeof options.open === 'string' ? options.open : devBase
    const url = path.startsWith('http')
      ? path
      : `${protocol}://${hostname}:${port}${path}`

    return url
  }
}

/**
 * @see https://github.com/vitejs/vite/blob/v4.4.7/packages/vite/src/node/utils.ts#L140
 */
export const bareImportRE = /^(?![a-zA-Z]:)[\w@](?!.*:\/\/)/

export function external_node_modules(): Plugin {
  let resolve: ResolveFn
  const ids = new Map<string, string>()

  return {
    name: 'external-node_modules',
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
