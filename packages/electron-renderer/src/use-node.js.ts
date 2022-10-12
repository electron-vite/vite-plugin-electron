import fs from 'fs'
import path from 'path'
import { builtinModules, createRequire } from 'module'
import type { ExternalOption, RollupOptions } from 'rollup'
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
  resolve?: (dependencies: string[]) => string[] | void
  /**
   * Whether node integration is enabled. Default is `false`.
   */
  nodeIntegration?: boolean
  /**
   * Whether node integration is enabled in web workers. Default is `false`. More
   * about this can be found in Multithreading.
   */
  nodeIntegrationInWorker?: boolean
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
      if (env.command === 'serve' || /* 🚧-① */pluginResolveId.api?.isWorker) {
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
        if (options.nodeIntegration) {
          config.build ??= {}
          config.build.rollupOptions ??= {}
          config.build.rollupOptions.external = withExternal(config.build.rollupOptions.external)
          setOutputFormat(config.build.rollupOptions)
        }

        if (plugin.api?.isWorker && options.nodeIntegrationInWorker) {
          /**
           * 🚧-①: 🤔 Not works (2022-10-08)
           * Worker build behavior is different from Web, `external` cannot be converted to `require("external-module")`.
           * So, it sitll necessary to correctly return the external-snippets in the `resolveId`, `load` hooks.
           */

          // config.worker ??= {}
          // config.worker.rollupOptions ??= {}
          // config.worker.rollupOptions.external = withExternal(config.worker.rollupOptions.external)
          // setOutputFormat(config.worker.rollupOptions)
        }

        return config
      }

      function withExternal(external?: ExternalOption) {
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
        return external
      }

      // At present, Electron(20) can only support CommonJs
      function setOutputFormat(rollupOptions: RollupOptions) {
        rollupOptions.output ??= {}
        if (Array.isArray(rollupOptions.output)) {
          for (const o of rollupOptions.output) {
            if (o.format === undefined) o.format = 'cjs'
          }
        } else {
          if (rollupOptions.output.format === undefined) rollupOptions.output.format = 'cjs'
        }
      }

    },
    async load(id) {
      if (env.command === 'serve' || /* 🚧-① */plugin.api?.isWorker) {
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

          const workerCount = getWorkerIncrementCount()
          const _M_ = typeof workerCount === 'number' ? `_M_$${workerCount}` : '_M_'
          const _D_ = typeof workerCount === 'number' ? `_D_$${workerCount}` : '_D_'

          const nodeModule = await import(id)
          const requireModule = `const ${_M_} = require("${id}");`
          const exportDefault = `const ${_D_} = ${_M_}.default || ${_M_};\nexport { ${_D_} as default };`
          const exportMembers = Object
            .keys(nodeModule)
            // https://github.com/electron-vite/electron-vite-react/issues/48
            .filter(n => !keywords.includes(n))
            .map(attr => `export const ${attr} = ${_M_}.${attr};`).join('\n')
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

  function getWorkerIncrementCount() {
    // 🚧-②: The worker file will build the role dependencies into one file, which may cause naming conflicts
    if (env.command === 'build' && plugin.api?.isWorker) {
      plugin.api.count ??= 0
      return plugin.api.count++
    }
  }

  return [
    pluginResolveId,
    plugin,
  ]
}

export function resolveModules(root: string, options: UseNodeJsOptions = {}) {
  const cjs_require = createRequire(import.meta.url)
  const cwd = process.cwd()
  const builtins = builtinModules.filter(e => !e.startsWith('_')); builtins.push('electron', ...builtins.map(m => `node:${m}`))
  // dependencies of package.json
  let dependencies: string[] = []
  // dependencies(ESM) of package.json
  const ESM_deps: string[] = []

  // Resolve package.json dependencies
  const pkgId = lookupFile('package.json', [root, cwd])
  if (pkgId) {
    const pkg = cjs_require(pkgId)
    for (const npmPkg of Object.keys(pkg.dependencies || {})) {
      const _pkgId = lookupFile(
        'package.json',
        [root, cwd].map(r => `${r}/node_modules/${npmPkg}`),
      )
      if (_pkgId) {
        const _pkg = cjs_require(_pkgId)
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
