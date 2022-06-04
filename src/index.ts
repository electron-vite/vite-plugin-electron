import type { Configuration } from './types'
import type { Plugin } from 'vite'
import { bootstrap } from './serve'
import { build } from './build'
import polyfillExports from '../polyfill-exports'

export { Configuration }

export function defineConfig(config: Configuration) {
  return config
}

export default function electron(config: Configuration): Plugin[] {
  const name = 'vite-plugin-electron'
  const opts: Partial<Plugin> = {
    config(_config) {
      if (!_config.build) _config.build = {}
      if (_config.build.emptyOutDir === undefined) {
        // Prevent accidental clearing of `dist/electron-main`, `dist/electron-preload`
        _config.build.emptyOutDir = false
      }
    },
  }

  return [
    {
      name: `${name}:serve`,
      apply: 'serve',
      configureServer(server) {
        server.httpServer.on('listening', () => {
          bootstrap(config, server)
        })
      },
      ...opts,
    },
    {
      name: `${name}:build`,
      apply: 'build',
      async configResolved(viteConfig) {
        await build(config, viteConfig)
      },
      ...opts,
    },
    // [🐞] exports is not defined 
    polyfillExports(),
  ]
}
