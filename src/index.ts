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
    config(conf) {
      if (!conf.build) conf.build = {}
      if (conf.build.emptyOutDir === undefined) {
        // prevent accidental clearing of `dist/electron/main`, `dist/electron/preload`
        conf.build.emptyOutDir = false
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
    // fix(🐞): exports is not defined 
    polyfillExports(),
  ]
}
