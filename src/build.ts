import { build as viteBuild } from 'vite'
import { resolveViteConfig, withExternalBuiltins } from './config'
import type { Configuration } from '.'

/** Work on the `vite build` command */
export async function build(config: Configuration | Configuration[]) {
  const configArray = Array.isArray(config) ? config : [config]

  for (const config of configArray) {
    const inlineConfig = withExternalBuiltins(resolveViteConfig(config))
    await viteBuild(inlineConfig)
  }
}
