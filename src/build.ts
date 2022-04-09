import { builtinModules } from 'module'
import { build as viteBuild, mergeConfig } from 'vite'
import type { ResolvedConfig, UserConfig } from 'vite'
import type { Configuration } from './types'

const isProduction = process.env./* from mode option */NODE_ENV === 'production'

export async function build(config: Configuration, viteConfig: ResolvedConfig) {
  if (config.preload) {
    const preloadConfig = resolveBuildConfig(
      'preload',
      config,
      viteConfig,
      config.preload.vite,
    )
    await viteBuild({
      configFile: false,
      ...preloadConfig,
    })
  }

  const mainConfig = resolveBuildConfig(
    'main',
    config,
    viteConfig,
    config.main.vite,
  )
  await viteBuild({
    configFile: false,
    ...mainConfig,
  })
}

// -------------------------------------------------

export function resolveBuildConfig(
  proc: 'main' | 'preload',
  config: Configuration,
  viteConfig: ResolvedConfig,
  overrides: Parameters<typeof mergeConfig>[1] = {},
) {
  const conf: UserConfig = {
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
  conf.build.outDir = `${viteConfig.build.outDir}/electron-${proc}`

  return mergeConfig(conf, overrides) as UserConfig
}
