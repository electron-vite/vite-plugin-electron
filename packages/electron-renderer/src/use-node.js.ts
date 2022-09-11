import fs from 'fs'
import path from 'path'
import { builtinModules } from 'module'
import {
  type Plugin,
  type ConfigEnv,
  normalizePath,
} from 'vite'

export interface UseNodeJsOptions {
  /**
   * Explicitly include/exclude some CJS modules  
   * `modules` includes `dependencies` of package.json  
   */
  resolve?: (modules: string[]) => string[] | void
}

// https://www.w3schools.com/js/js_reserved.asp
const keywords = [
  'abstract',
  'arguments',
  'await',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'double',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'final',
  'finally',
  'float',
  'for',
  'function',
  'goto',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'int',
  'interface',
  'let',
  'long',
  'native',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'short',
  'static',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'volatile',
  'while',
  'with',
  'yield',
]

const electron = `
/**
 * All exports module see https://www.electronjs.org -> API -> Renderer Process Modules
 */
const electron = require("electron");

// Proxy in Worker
let _ipcRenderer;
if (typeof document === 'undefined') {
  _ipcRenderer = {};
  const keys = [
    'invoke',
    'postMessage',
    'send',
    'sendSync',
    'sendTo',
    'sendToHost',
    // propertype
    'addListener',
    'emit',
    'eventNames',
    'getMaxListeners',
    'listenerCount',
    'listeners',
    'off',
    'on',
    'once',
    'prependListener',
    'prependOnceListener',
    'rawListeners',
    'removeAllListeners',
    'removeListener',
    'setMaxListeners',
  ];
  for (const key of keys) {
    _ipcRenderer[key] = () => {
      throw new Error(
        'ipcRenderer doesn\\'t work in a Web Worker.\\n' +
        'You can see https://github.com/electron-vite/vite-plugin-electron/issues/69'
      );
    };
  }
} else {
  _ipcRenderer = electron.ipcRenderer;
}

export { electron as default };
export const clipboard = electron.clipboard;
export const contextBridge = electron.contextBridge;
export const crashReporter = electron.crashReporter;
export const ipcRenderer = _ipcRenderer;
export const nativeImage = electron.nativeImage;
export const shell = electron.shell;
export const webFrame = electron.webFrame;
export const deprecate = electron.deprecate;
`

export default function useNodeJs(options: UseNodeJsOptions = {}): Plugin[] {
  let env: ConfigEnv
  const builtins: string[] = []
  const dependencies: string[] = []
  const ESM_deps: string[] = []
  const CJS_modules: string[] = [] // builtins + dependencies
  const moduleCache = new Map([['electron', electron]])

  // When `electron` files or folders exist in the root directory, it will cause Vite to incorrectly splicing the `/@fs/` prefix.
  // Here, use `\0` prefix avoid this behavior
  const prefix = '\0'
  const pluginResolveId: Plugin = {
    name: 'vite-plugin-electron-renderer:use-node.js[resolveId]',
    // Bypassing Vite's builtin 'vite:resolve' plugin
    enforce: 'pre',
    resolveId(source) {
      if (env.command === 'serve') {
        if (ESM_deps.includes(source)) return // by vite-plugin-esmodule
        if (CJS_modules.includes(source)) return prefix + source
      }
    },
  }
  const plugin: Plugin = {
    name: 'vite-plugin-electron-renderer:use-node.js',
    // 🚧 Must be use config hook
    config(config, _env) {
      env = _env

      // https://github.com/vitejs/vite/blob/53799e1cced7957f9877a5b5c9b6351b48e216a7/packages/vite/src/node/config.ts#L439-L442
      const root = normalizePath(config.root ? path.resolve(config.root) : process.cwd())
      const resolved = resolveModules(root)

      builtins.push(...resolved.builtins)
      dependencies.push(...resolved.dependencies)
      ESM_deps.push(...resolved.ESM_deps)

      // Since `vite-plugin-electron-renderer@0.5.10` `dependencies(NodeJs_pkgs)` fully controlled by the user.
      // Because `dependencies(NodeJs_pkgs)` may contain Web packages. e.g. `vue`, `react`.
      // Opinionated treat Web packages as external modules, which will cause errors.
      let NodeJs_pkgs: string[] = []
      if (options.resolve) {
        const pkgs = options.resolve(dependencies)
        if (pkgs) {
          NodeJs_pkgs = pkgs
        }
      }

      CJS_modules.push(...builtins.concat(NodeJs_pkgs))

      if (env.command === 'serve') {
        if (!config.resolve) config.resolve = {}
        if (!config.resolve.conditions) config.resolve.conditions = ['node']

        if (!config.optimizeDeps) config.optimizeDeps = {}
        if (!config.optimizeDeps.exclude) config.optimizeDeps.exclude = []

        // Node.js packages in dependencies and `electron` should not be Pre-Building
        config.optimizeDeps.exclude.push(...NodeJs_pkgs, 'electron')

        return config
      }

      if (env.command === 'build') {
        // Rollup ---- init ----
        if (!config.build) config.build = {}
        if (!config.build.rollupOptions) config.build.rollupOptions = {}
        if (!config.build.rollupOptions.output) config.build.rollupOptions.output = {}

        // Rollup ---- external ----
        let external = config.build.rollupOptions.external
        if (
          Array.isArray(external) ||
          typeof external === 'string' ||
          external instanceof RegExp
        ) {
          // @ts-ignore
          external = CJS_modules.concat(external)
        } else if (typeof external === 'function') {
          const original = external
          external = function externalFn(source, importer, isResolved) {
            if (CJS_modules.includes(source)) {
              return true
            }
            return original(source, importer, isResolved)
          }
        } else {
          external = CJS_modules
        }
        config.build.rollupOptions.external = external

        // Rollup ---- output.format ----
        const output = config.build.rollupOptions.output
        if (Array.isArray(output)) {
          for (const o of output) {
            if (o.format === undefined) o.format = 'cjs'
          }
        } else {
          // external modules such as `electron`, `fs`
          // they can only be loaded normally on CommonJs
          if (output.format === undefined) output.format = 'cjs'
        }

        return config
      }

    },
    load(id) {
      if (env.command === 'serve') {
        /** 
         * ```
         * 🎯 Using Node.js packages(CJS) in Electron-Renderer(vite serve)
         * 
         * ┏————————————————————————————————————————┓                    ┏—————————————————┓
         * │ import { ipcRenderer } from 'electron' │                    │ Vite dev server │
         * ┗————————————————————————————————————————┛                    ┗—————————————————┛
         *                    │                                                   │
         *                    │ 1. HTTP(Request): electron module                 │
         *                    │ ————————————————————————————————————————————————> │
         *                    │                                                   │
         *                    │                                                   │
         *                    │ 2. Intercept in load-hook(Plugin)                 │
         *                    │ 3. Generate a virtual ESM module(electron)        │
         *                    │    ↓                                              │
         *                    │    const { ipcRenderer } = require('electron')    │
         *                    │    export { ipcRenderer }                         │
         *                    │                                                   │
         *                    │                                                   │
         *                    │ 4. HTTP(Response): electron module                │
         *                    │ <———————————————————————————————————————————————— │
         *                    │                                                   │
         * ┏————————————————————————————————————————┓                    ┏—————————————————┓
         * │ import { ipcRenderer } from 'electron' │                    │ Vite dev server │
         * ┗————————————————————————————————————————┛                    ┗—————————————————┛
         * 
         * ```
         */

        id = id.replace(prefix, '')
        if (CJS_modules.includes(id)) {
          const cache = moduleCache.get(id)
          if (cache) return cache

          const nodeModule = require(id)
          const requireModule = `const _M_ = require("${id}");`
          const exportDefault = `const _D_ = _M_.default || _M_;\nexport { _D_ as default };`
          const exportMembers = Object
            .keys(nodeModule)
            // https://github.com/electron-vite/electron-vite-react/issues/48
            .filter(n => !keywords.includes(n))
            .map(attr => `export const ${attr} = _M_.${attr};`).join('\n')
          const nodeModuleCodeSnippet = `
${requireModule}
${exportDefault}
${exportMembers}
`

          moduleCache.set(id, nodeModuleCodeSnippet)
          return nodeModuleCodeSnippet
        }
      }

    },
  }

  return [
    pluginResolveId,
    plugin,
  ]
}

export function resolveModules(root: string, options: UseNodeJsOptions = {}) {
  const cwd = process.cwd()
  const builtins = builtinModules.filter(e => !e.startsWith('_')); builtins.push('electron', ...builtins.map(m => `node:${m}`))
  // dependencies of package.json
  let dependencies: string[] = []
  // dependencies(ESM) of package.json
  const ESM_deps: string[] = []

  // Resolve package.json dependencies
  const pkgId = lookupFile('package.json', [root, cwd])
  if (pkgId) {
    const pkg = require(pkgId)
    for (const npmPkg of Object.keys(pkg.dependencies || {})) {
      const _pkgId = lookupFile(
        'package.json',
        [root, cwd].map(r => `${r}/node_modules/${npmPkg}`),
      )
      if (_pkgId) {
        const _pkg = require(_pkgId)
        if (_pkg.type === 'module') {
          ESM_deps.push(npmPkg)
          continue
        }
      }

      // TODO: Nested package name, but you can explicity include it by `options.resolve`
      dependencies.push(npmPkg)
    }
  }

  if (options.resolve) {
    const tmp = options.resolve(dependencies)
    if (tmp) dependencies = tmp
  }

  return {
    builtins,
    dependencies,
    ESM_deps,
  }
}

function lookupFile(filename: string, paths: string[]) {
  for (const p of paths) {
    const filepath = path.join(p, filename)
    if (fs.existsSync(filepath)) {
      return filepath
    }
  }
}
