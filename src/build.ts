import { build as viteBuild } from 'vite'
import {
  type Configuration,
  resolveViteConfig,
  withExternalBuiltins,
} from './config'

/** Work on the `vite build` command */
export async function build(config: Configuration | Configuration[]) {
  const configArray = Array.isArray(config) ? config : [config]

  for (const config of configArray) {
    const inlineConfig = withExternalBuiltins(resolveViteConfig(config))
    await viteBuild(inlineConfig)
  }
}
