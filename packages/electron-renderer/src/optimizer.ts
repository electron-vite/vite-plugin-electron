import fs from 'node:fs'
import path from 'node:path'
import { createRequire, builtinModules } from 'node:module'
import type { Alias, Plugin, UserConfig } from 'vite'
import esbuild from 'esbuild'
import libEsm from 'lib-esm'

export type DepOptimizationConfig = {
  include?: (string | {
    name: string
    /**
     * Explicitly specify the module type
     */
    type?: "commonjs" | "module"
  })[]
  buildOptions?: import('esbuild').BuildOptions
  // TODO: consider support webpack 🤔
  // webpack?: import('webpack').Configuration
}

const cjs_require = createRequire(import.meta.url)
let root: string
let node_modules_path: string
const CACHE_DIR = '.vite-electron-renderer'

export default function optimizer(options: DepOptimizationConfig): Plugin {
  return {
    name: 'vite-plugin-electron-renderer:optimizer',
    // At "build" phase, Node.js npm-package will be resolve by './use-node.js.ts'
    apply: 'serve',
    async config(config) {
      root = config.root ? path.resolve(config.root) : process.cwd()
      node_modules_path = node_modules(root)

      fs.rmSync(path.join(node_modules_path, CACHE_DIR), { recursive: true, force: true })
      const { include, buildOptions } = options
      if (!include?.length) return

      const deps: {
        esm?: string
        cjs?: string
        filename?: string
      }[] = []
      const aliases: Alias[] = []
      const optimizeDepsExclude = []

      for (const item of include) {
        let name: string
        let type: string | undefined
        if (typeof item === 'string') {
          name = item
        } else {
          name = item.name
          type = item.type
        }
        if (type === 'module') {
          deps.push({ esm: name })
          continue
        }
        if (type === 'commonjs') {
          deps.push({ cjs: name })
          continue
        }
        const pkg = cjs_require(path.join(node_modules_path, name, 'package.json'))
        if (pkg) {
          // bare module
          if (pkg.type === 'module') {
            deps.push({ esm: name })
            continue
          }
          deps.push({ cjs: name })
          continue
        }
        const tmp = path.join(node_modules_path, name)
        try {
          // dirname or filename
          // `foo/bar` or `foo/bar/index.js`
          const filename = cjs_require.resolve(tmp)
          if (path.extname(filename) === '.mjs') {
            deps.push({ esm: name, filename })
            continue
          }
          deps.push({ cjs: name, filename })
        } catch (error) {
          console.log('Can not resolve path:', tmp)
        }
      }

      for (const dep of deps) {
        if (!dep.filename) {
          const module = (dep.cjs || dep.esm) as string
          try {
            dep.filename = cjs_require.resolve(module)
          } catch (error) {
            console.log('Can not resolve module:', module)
          }
        }
        if (!dep.filename) {
          continue
        }

        if (dep.cjs) {
          cjsBundling({
            name: dep.cjs,
            require: dep.cjs,
            requireId: dep.filename,
          })
        } else if (dep.esm) {
          esmBundling({
            name: dep.esm,
            entry: dep.filename,
            buildOptions,
          })
        }

        const name = dep.cjs || dep.esm
        if (name) {
          optimizeDepsExclude.push(name)
          const { destname } = dest(name)
          aliases.push({ find: name, replacement: destname })
        }
      }

      modifyOptimizeDeps(config, optimizeDepsExclude)
      modifyAlias(config, aliases)
    },
  }
}

function cjsBundling(args: {
  name: string
  require: string
  requireId: string
}) {
  const { name, require, requireId } = args
  const { exports } = libEsm({ exports: Object.keys(cjs_require(requireId)) })
  const code = `const _M_ = require("${require}");\n${exports}`
  writeFile({ name, code })
}

async function esmBundling(args: {
  name: string,
  entry: string,
  buildOptions?: esbuild.BuildOptions,
}) {
  const { name, entry, buildOptions } = args
  const { name_cjs, destname_cjs } = dest(name)
  return esbuild.build({
    entryPoints: [entry],
    outfile: destname_cjs,
    target: 'node14',
    format: 'cjs',
    bundle: true,
    sourcemap: true,
    external: [
      ...builtinModules,
      ...builtinModules.map(mod => `node:${mod}`),
    ],
    ...buildOptions,
  }).then(result => {
    if (!result.errors.length) {
      cjsBundling({
        name,
        require: `${CACHE_DIR}/${name}/${name_cjs}`,
        requireId: destname_cjs,
      })
    }
    return result
  })
}

function writeFile(args: {
  name: string
  code: string
}) {
  const { name, code } = args
  const { destpath, destname } = dest(name)
  !fs.existsSync(destpath) && fs.mkdirSync(destpath, { recursive: true })
  fs.writeFileSync(destname, code)
  console.log('Pre-bundling:', name)
}

function dest(name: string) {
  const destpath = path.join(node_modules_path, CACHE_DIR, name)
  const name_js = 'index.js'
  const name_cjs = 'index.cjs'
  !fs.existsSync(destpath) && fs.mkdirSync(destpath, { recursive: true })
  return {
    destpath,
    name_js,
    name_cjs,
    destname: path.join(destpath, name_js),
    destname_cjs: path.join(destpath, name_cjs),
  }
}

function modifyOptimizeDeps(config: UserConfig, exclude: string[]) {
  config.optimizeDeps ??= {}
  config.optimizeDeps.exclude ??= []
  config.optimizeDeps.exclude.push(...exclude)
}

function modifyAlias(config: UserConfig, aliases: Alias[]) {
  config.resolve ??= {}
  config.resolve.alias ??= []
  if (Object.prototype.toString.call(config.resolve.alias) === '[object Object]') {
    config.resolve.alias = Object
      .entries(config.resolve.alias)
      .reduce<Alias[]>((memo, [find, replacement]) => memo.concat({ find, replacement }), [])
  }
  (config.resolve.alias as Alias[]).push(...aliases)
}

function node_modules(root: string, count = 0): string {
  if (node_modules.p) {
    return node_modules.p
  }
  const p = path.join(root, 'node_modules')
  if (fs.existsSync(p)) {
    return node_modules.p = p
  }
  if (count >= 19) {
    throw new Error('Can not found node_modules directory.')
  }
  return node_modules(path.join(root, '..'), count + 1)
}
// For ts-check
node_modules.p = ''
