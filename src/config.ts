import fs from 'fs'
import path from 'path'
import { builtinModules } from 'module'
import type { InlineConfig, ResolvedConfig } from 'vite'
import { mergeConfig, normalizePath } from 'vite'
import type { Configuration } from './types'

const builtins = builtinModules
  .filter(e => !e.startsWith('_'))
  .map(e => [e, `node:${e}`]).flat()
  .concat('electron')
// dependencies of package.json
const dependencies = []
const modules = {
  main: [],
  preload: [],
}

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
  const conf: InlineConfig = {
    // 🚧 Avoid recursive build caused by load config file
    configFile: false,
    envFile: false,
    publicDir: false,

    build: {
      emptyOutDir: false,
      minify: process.env./* from mode option */NODE_ENV === 'production',
    },
  }

  // In fact, there may be more than one `preload`, but there is only one `main`
  if (proc === 'preload') {
    conf.build.rollupOptions = {
      ...conf.build.rollupOptions,
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
    conf.build.lib = {
      entry: config[proc].entry,
      formats: ['cjs'],
      fileName: () => '[name].js',
    }
  }

  // Assign default dir
  conf.build.outDir = normalizePath(`${viteConfig.build.outDir}/electron`)

  return mergeConfig(conf, config[proc]?.vite || {}) as InlineConfig
}

export function createWithExternal(runtime: Runtime) {
  const { proc, config, viteConfig } = runtime
  // Resolve package.json dependencies
  let pkgId = path.join(viteConfig.root, 'package.json')
  if (!fs.existsSync(pkgId)) {
    pkgId = path.join(process.cwd(), 'package.json')
  }
  if (fs.existsSync(pkgId)) {
    const pkg = require(pkgId)
    // TODO: Nested package name
    dependencies.push(...Object.keys(pkg.dependencies || {}))
  }
  modules[proc] = builtins.concat(dependencies)

  const fn = config[proc].resolve
  if (fn) {
    // TODO: 应该仅仅是 dependencies
    const tmp = fn(modules[proc])
    if (tmp) modules[proc] = tmp
  }

  return function withExternal(ICG: InlineConfig) {

    if (!ICG.build) ICG.build = {}
    if (!ICG.build.rollupOptions) ICG.build.rollupOptions = {}

    const mods = modules[proc]
    let external = ICG.build.rollupOptions.external
    if (
      Array.isArray(external) ||
      typeof external === 'string' ||
      external instanceof RegExp
    ) {
      external = mods.concat(external)
    } else if (typeof external === 'function') {
      const original = external
      external = function (source, importer, isResolved) {
        if (mods.includes(source)) {
          return true
        }
        return original(source, importer, isResolved)
      }
    } else {
      external = mods
    }
    ICG.build.rollupOptions.external = external

    return ICG
  }
}
