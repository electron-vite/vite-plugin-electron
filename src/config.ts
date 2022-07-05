import fs from 'fs'
import path from 'path'
import { builtinModules } from 'module'
import type { InlineConfig, ResolvedConfig } from 'vite'
import type { Configuration } from './types'

const builtins = builtinModules
  .filter(e => !e.startsWith('_'))
  .map(e => [e, `node:${e}`]).flat()
  .concat('electron')
// dependencies of package.json
const dependencies = []
const modules = {
  main: [],
  preload: [],
}

export function createWithExternal(
  proc: 'main' | 'preload',
  config: Configuration,
  viteConfig: ResolvedConfig,
) {
  // Resolve package.json dependencies
  let pkgId = path.join(viteConfig.root, 'package.json')
  if (!fs.existsSync(pkgId)) {
    pkgId = path.join(process.cwd(), 'package.json')
  }
  if (fs.existsSync(pkgId)) {
    const pkg = require(pkgId)
    // TODO: Nested package name
    dependencies.push(...Object.keys(pkg.dependencies || {}))
  }
  modules[proc] = builtins.concat(dependencies)

  const fn = config[proc].resolve
  if (fn) {
    // TODO: 应该仅仅是 dependencies
    const tmp = fn(modules[proc])
    if (tmp) modules[proc] = tmp
  }

  return function withExternal(ICG: InlineConfig) {

    if (!ICG.build) ICG.build = {}
    if (!ICG.build.rollupOptions) ICG.build.rollupOptions = {}

    const mods = modules[proc]
    let external = ICG.build.rollupOptions.external
    if (
      Array.isArray(external) ||
      typeof external === 'string' ||
      external instanceof RegExp
    ) {
      external = mods.concat(external)
    } else if (typeof external === 'function') {
      const original = external
      external = function (source, importer, isResolved) {
        if (mods.includes(source)) {
          return true
        }
        return original(source, importer, isResolved)
      }
    } else {
      external = mods
    }
    ICG.build.rollupOptions.external = external

    return ICG
  }
}
