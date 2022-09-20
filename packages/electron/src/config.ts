import fs from 'fs'
import path from 'path'
import type { AddressInfo } from 'net'
import {
  type InlineConfig,
  type ResolvedConfig,
  type Plugin,
  type ViteDevServer,
  mergeConfig,
  normalizePath,
} from 'vite'
import { resolveModules } from 'vite-plugin-electron-renderer/plugins/use-node.js'
import type { Configuration } from './types'

export interface Runtime {
  proc: 'main' | 'preload' | 'worker'
  config: Configuration
  viteConfig: ResolvedConfig
}

export function resolveRuntime(
  proc: 'main' | 'preload' | 'worker',
  config: Configuration,
  viteConfig: ResolvedConfig,
): Runtime {
  return { proc, config, viteConfig }
}

export function resolveBuildConfig(runtime: Runtime): InlineConfig {
  const { proc, config, viteConfig } = runtime
  const defaultConfig: InlineConfig = {
    // 🚧 Avoid recursive build caused by load config file
    configFile: false,
    publicDir: false,
    mode: viteConfig.mode,

    build: {
      emptyOutDir: false,
      minify: process.env./* from mode option */NODE_ENV === 'production',
    },
  }

  // In practice, there may be multiple Electron-Preload, but only one Electron-Main

  if (proc === 'preload') {
    // Electron-Preload
    defaultConfig.build.rollupOptions = {
      ...defaultConfig.build.rollupOptions,
      input: config[proc].input,
      output: {
        format: 'cjs',
        // Only one file will be bundled, which is consistent with the behavior of `build.lib`
        manualChunks: {},
        // https://github.com/vitejs/vite/blob/09c4fc01a83b84f77b7292abcfe7500f0e948db6/packages/vite/src/node/build.ts#L467
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    }
  } else if (proc === 'worker') {
    // Electron-Preload
    defaultConfig.build.rollupOptions = {
      ...defaultConfig.build.rollupOptions,
      input: config[proc].input,
      output: {
        format: 'cjs',
        // Only one file will be bundled, which is consistent with the behavior of `build.lib`
        manualChunks: {},
        // https://github.com/vitejs/vite/blob/09c4fc01a83b84f77b7292abcfe7500f0e948db6/packages/vite/src/node/build.ts#L467
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    }
  } else {
    // Electron-Main
    // TODO: consider also support `build.rollupOptions`
    defaultConfig.build.lib = {
      entry: config[proc].entry,
      formats: ['cjs'],
      fileName: () => '[name].js',
    }
  }

  // Assign default dir
  defaultConfig.build.outDir = normalizePath(`${viteConfig.build.outDir}/electron`)

  return mergeConfig(defaultConfig, config[proc]?.vite || {}) as InlineConfig
}

/**
 * `dependencies` of package.json will be inserted into `build.rollupOptions.external`
 */
export function createWithExternal(runtime: Runtime) {
  const { proc, config, viteConfig } = runtime
  const { builtins, dependencies } = resolveModules(viteConfig.root, config[proc])
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

export function checkPkgMain(runtime: Runtime, electronMainBuildResolvedConfig: ResolvedConfig) {
  const mainConfig = electronMainBuildResolvedConfig
  const { config, viteConfig } = runtime

  const cwd = process.cwd()
  const pkgId = path.join(cwd, 'package.json')
  if (!fs.existsSync(pkgId)) return

  const distfile = normalizePath(path.resolve(
    mainConfig.root,
    mainConfig.build.outDir,
    path.parse(config.main.entry).name,
  )
    // https://github.com/electron-vite/vite-plugin-electron/blob/5cd2c2ce68bb76b2a1770d50aa4164a59ab8110c/packages/electron/src/config.ts#L57
    + '.js')

  let message: string
  const pkg = require(pkgId)
  if (!(pkg.main && distfile.endsWith(pkg.main))) {
    message = `
[${new Date().toLocaleString()}]
  Command: "vite ${viteConfig.command}".
  The main field in package.json may be incorrect, which causes the App to fail to start.
  File build path: "${distfile}".
  Recommended main value: "${distfile.replace(cwd + '/', '')}".
`
  }

  if (message) {
    fs.appendFileSync(path.join(cwd, 'vite-plugin-electron.log'), message)
    return message
  }
}

checkPkgMain.buildElectronMainPlugin = function buildElectronMainPlugin(runtime: Runtime): Plugin {
  return {
    name: 'vite-plugin-electron:check-package.json-main',
    configResolved(config) {
      checkPkgMain(runtime, config)
    },
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
  const addressInfo = server.httpServer.address()
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
