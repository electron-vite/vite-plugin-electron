import type { InlineConfig, ResolvedConfig } from 'vite'
import { mergeConfig, normalizePath } from 'vite'
import type { Configuration } from './types'
import { resolveModules } from 'vite-plugin-electron-renderer/plugins/use-node.js'

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

  // In practice, there may be multiple Electron-Preload, but only one Electron-Main

  if (proc === 'preload') {
    // Electron-Preload
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
    // Electron-Main
    // TODO: consider also support `build.rollupOptions`
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
  const { builtins, dependencies } = resolveModules(viteConfig.root, config[proc])
  const modules = builtins.concat(dependencies)

  return function withExternal(ICG: InlineConfig) {

    if (!ICG.build) ICG.build = {}
    if (!ICG.build.rollupOptions) ICG.build.rollupOptions = {}

    let external = ICG.build.rollupOptions.external
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
    ICG.build.rollupOptions.external = external

    return ICG
  }
}
