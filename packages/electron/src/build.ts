import {
  type ResolvedConfig,
  build as viteBuild,
} from 'vite'
import {
  checkPkgMain,
  createWithExternal,
  resolveBuildConfig,
  resolveRuntime,
} from './config'
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
  const ILCG = createWithExternal(mainRuntime)(resolveBuildConfig(mainRuntime))
  if (!ILCG.plugins) ILCG.plugins = []
  ILCG.plugins.push(checkPkgMain.buildElectronMainPlugin(mainRuntime))

  await viteBuild(ILCG)
}
