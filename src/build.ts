import { dirname, join } from 'path'
import { builtinModules } from 'module'
import { build as viteBuild, InlineConfig, mergeConfig } from 'vite'
import type { ResolvedConfig } from 'vite'
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
      minify: isProduction,
      sourcemap: true,
      rollupOptions: {
        external: [
          'electron',
          ...builtinModules,
        ],
      },
    },
  }
  let entry: string

  // In fact, there may be more than one `preload`, but there is only one `main`
  if (proc === 'preload') {
    const input = config[proc].input
    conf.build.rollupOptions = {
      ...conf.build.rollupOptions,
      input,
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

    if (Array.isArray(input)) {
      // This may inaccuracy, you can explicitly specify `build.outDir` to avoid it
      entry = input[0]
    } else if (typeof input === 'object') {
      // This may inaccuracy, you can explicitly specify `build.outDir` to avoid it
      entry = Object.values(input)[0]
    } else {
      entry = input
    }
  } else {
    conf.build.lib = {
      entry: entry = config[proc].entry,
      formats: ['cjs'],
      fileName: () => '[name].js',
    }
  }

  // Assign default dir
  const outDir = dirname(join(
    viteConfig.build.outDir,
    entry.replace(viteConfig.root, '')
  ))
  conf.build.outDir = outDir

  return mergeConfig(conf, config[proc]?.vite || {}) as InlineConfig
}
