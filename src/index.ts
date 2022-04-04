import type { Configuration } from './types'

export { electron as default } from './plugin'
export { Configuration }

export function defineConfig(config: Configuration) {
  return config
}
