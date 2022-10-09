import {
  type ResolvedConfig,
  build as viteBuild,
} from 'vite'
import { createWithExternal, resolveBuildConfig } from './config'
import type { Configuration } from '.'

export async function build(config: Configuration, resolved: ResolvedConfig) {
  const withExternal = createWithExternal(resolved.root)
  const inlineConfig = withExternal(resolveBuildConfig(config, resolved))
  await viteBuild(inlineConfig)
}
