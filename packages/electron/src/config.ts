import type { AddressInfo } from 'net'
import {
  type InlineConfig,
  type ResolvedConfig,
  type ViteDevServer,
  mergeConfig,
  normalizePath,
} from 'vite'
import { resolveModules } from 'vite-plugin-electron-renderer/plugins/use-node.js'
import type { Configuration } from './types'

export function resolveBuildConfig(option: Configuration, resolved: ResolvedConfig): InlineConfig {
  const defaultConfig: InlineConfig = {
    // 🚧 Avoid recursive build caused by load config file
    configFile: false,
    publicDir: false,
    mode: resolved.mode,

    build: {
      // @ts-ignore
      lib: option.entry && {
        entry: option.entry,
        // At present, Electron(20) can only support CommonJs
        formats: ['cjs'],
        fileName: () => '[name].js',
      },
      emptyOutDir: false,
      // dist/electron
      outDir: normalizePath(`${resolved.build.outDir}/electron`),
      minify: resolved.command === 'build', // 🤔 process.env./* from mode option */NODE_ENV === 'production',
    },
  }

  return mergeConfig(defaultConfig, option?.vite || {}) as InlineConfig
}

/**
 * `dependencies` of package.json will be inserted into `build.rollupOptions.external`
 */
export function createWithExternal(option: Configuration, resolved: ResolvedConfig) {
  const { builtins, dependencies } = resolveModules(resolved.root)
  const modules = builtins.concat(dependencies)

  return function withExternal(ILCG: InlineConfig) {

    if (!ILCG.build) ILCG.build = {}
    if (!ILCG.build.rollupOptions) ILCG.build.rollupOptions = {}

    let external = ILCG.build.rollupOptions.external
    if (
      Array.isArray(external) ||
      typeof external === 'string' ||
      external instanceof RegExp
    ) {
      external = modules.concat(external as string[])
    } else if (typeof external === 'function') {
      const original = external
      external = function (source, importer, isResolved) {
        if (modules.includes(source)) {
          return true
        }
        return original(source, importer, isResolved)
      }
    } else {
      external = modules
    }
    ILCG.build.rollupOptions.external = external

    return ILCG
  }
}

/**
 * @see https://github.com/vitejs/vite/blob/c3f6731bafeadd310efa4325cb8dcc639636fe48/packages/vite/src/node/constants.ts#L131-L141
 */
export function resolveHostname(hostname: string) {
  const loopbackHosts = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    '0000:0000:0000:0000:0000:0000:0000:0001'
  ])
  const wildcardHosts = new Set([
    '0.0.0.0',
    '::',
    '0000:0000:0000:0000:0000:0000:0000:0000'
  ])

  return loopbackHosts.has(hostname) || wildcardHosts.has(hostname) ? 'localhost' : hostname
}

export function resolveEnv(server: ViteDevServer) {
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

    return { url, hostname, port }
  }
}
