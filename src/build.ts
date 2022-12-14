import { build as viteBuild } from 'vite'
import {
  type Configuration,
  resolveViteConfig,
  withExternalBuiltins,
} from './config'

/** Work on the `vite build` command */
export function build(config: Configuration) {
  return viteBuild(withExternalBuiltins(resolveViteConfig(config)))
}
