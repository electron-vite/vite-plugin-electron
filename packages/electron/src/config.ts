import fs from 'fs'
import path from 'path'
import {
  type InlineConfig,
  type ResolvedConfig,
  type Plugin,
  mergeConfig,
  normalizePath,
} from 'vite'
import { resolveModules } from 'vite-plugin-electron-renderer/plugins/use-node.js'
import type { Configuration } from './types'

export interface Runtime {
  proc: 'main' | 'preload'
  config: Configuration
  viteConfig: ResolvedConfig
}

export function resolveRuntime(
  proc: 'main' | 'preload',
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
