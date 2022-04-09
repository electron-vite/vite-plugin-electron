import { builtinModules } from 'module'
import type { ResolvedConfig, UserConfig } from 'vite'
import { build as viteBuild, mergeConfig } from 'vite'
import type { Configuration } from './types'

const isProduction = process.env./* from mode option */NODE_ENV === 'production'

export function buildConfig(
  config: Configuration,
  viteConfig: ResolvedConfig,
  proc: 'main' | 'preload'
) {
  const conf: UserConfig = {
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
  return conf
}

export async function build(config: Configuration, viteConfig: ResolvedConfig) {
  if (config.preload) {
    const preloadConfig = buildConfig(config, viteConfig, 'preload')
    await viteBuild({
      configFile: false,
      ...mergeConfig(preloadConfig, config.preload.vite || {}),
    })
  }

  const mainConfig = buildConfig(config, viteConfig, 'main')
  await viteBuild({
    configFile: false,
    ...mergeConfig(mainConfig, config.main.vite || {}),
  })
}
