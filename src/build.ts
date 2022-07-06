import type { ResolvedConfig } from 'vite'
import { build as viteBuild } from 'vite'
import { createWithExternal, resolveBuildConfig, resolveRuntime } from './config'
import type { Configuration } from './types'

export async function build(config: Configuration, viteConfig: ResolvedConfig) {
  if (config.preload) {
    const preloadRuntime = resolveRuntime('preload', config, viteConfig)
    await viteBuild(
      createWithExternal(preloadRuntime)(
        resolveBuildConfig(preloadRuntime)
      )
    )
  }

  const mainRuntime = resolveRuntime('main', config, viteConfig)
  await viteBuild(
    createWithExternal(mainRuntime)(
      resolveBuildConfig(mainRuntime)
    )
  )
}
