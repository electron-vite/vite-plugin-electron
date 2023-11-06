import type { AddressInfo } from 'node:net'
import { builtinModules } from 'node:module'
import {
  type InlineConfig,
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

export function calcEntryCount(optionsArray: ElectronOptions[]) {
  return optionsArray.reduce((count, options) => {
    const input = options.vite?.build?.rollupOptions?.input

    // `input` option have higher priority.
    // https://github.com/vitejs/vite/blob/v4.4.9/packages/vite/src/node/build.ts#L494
    if (input) {
      count += typeof input === 'string'
        ? 1
        : Object.keys(input).length
    } else if (options.entry) {
      count += typeof options.entry === 'string'
        ? 1
        : Object.keys(options.entry).length
    }

    return count
  }, 0)
}
