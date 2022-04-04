import { builtinModules } from 'module'
import type { ResolvedConfig, UserConfig } from 'vite'
import { build as viteBuild } from 'vite'
import { mergeConfigRecursively } from './utils'
import type { Configuration } from './types'

const isProduction = process.env./* from mode option */NODE_ENV === 'production'

export function buildConfig(
  config: Configuration,
  viteConfig: ResolvedConfig,
  name: 'main' | 'preload'
) {
  return {
    build: {
      minify: isProduction,
      sourcemap: true,
      lib: {
        entry: config[name].entry,
        formats: ['cjs'],
        fileName: () => '[name].js',
      },
      rollupOptions: {
        external: [
          'electron',
          ...builtinModules,
        ],
      },
    },
  } as UserConfig
}

export async function build(config: Configuration, viteConfig: ResolvedConfig) {
  if (config.preload) {
    const preloadConfig = buildConfig(config, viteConfig, 'preload')
    await viteBuild({
      configFile: false,
      ...mergeConfigRecursively(preloadConfig, config.preload.vite || {}),
    })
  }

  const mainConfig = buildConfig(config, viteConfig, 'main')
  await viteBuild({
    configFile: false,
    ...mergeConfigRecursively(mainConfig, config.main.vite || {}),
  })
}
