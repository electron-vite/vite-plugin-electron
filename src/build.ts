import { builtinModules } from 'module'
import {
  type InlineConfig,
  type ResolvedConfig,
  build as viteBuild,
  mergeConfig,
  normalizePath,
} from 'vite'
import type { Configuration } from './types'

const isProduction = process.env./* from mode option */NODE_ENV === 'production'

export async function build(config: Configuration, viteConfig: ResolvedConfig) {
  if (config.preload) {
    await viteBuild(resolveBuildConfig('preload', config, viteConfig))
  }
  await viteBuild(resolveBuildConfig('main', config, viteConfig))
}

// -------------------------------------------------

export function resolveBuildConfig(
  proc: 'main' | 'preload',
  config: Configuration,
  viteConfig: ResolvedConfig,
): InlineConfig {
  const conf: InlineConfig = {
    // 🚧 Avoid recursive build caused by load config file
    configFile: false,
    envFile: false,
    publicDir: false,

    build: {
      emptyOutDir: false,
      minify: isProduction,
      rollupOptions: {
        external: [
          'electron',
          ...builtinModules,
          ...builtinModules.map(module => `node:${module}`)
        ],
      },
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
