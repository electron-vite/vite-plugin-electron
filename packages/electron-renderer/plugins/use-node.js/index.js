const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');
const { normalizePath } = require('vite');

/**
 * @type {import('.').UseNodeJs}
 */
function useNodeJs(options = {}) {
  /**
   * @type {import('vite').ConfigEnv}
   */
  let env;
  const builtins = [];
  const dependencies = [];
  const ESM_deps = [];
  const CJS_modules = []; // builtins + dependencies
  const moduleCache = new Map([
    ['electron', `
/**
 * All exports module see https://www.electronjs.org -> API -> Renderer Process Modules
 */
const electron = require("electron");
const {
  clipboard,
  nativeImage,
  shell,
  contextBridge,
  crashReporter,
  ipcRenderer,
  webFrame,
  desktopCapturer,
  deprecate,
} = electron;

export {
  electron as default,
  clipboard,
  nativeImage,
  shell,
  contextBridge,
  crashReporter,
  ipcRenderer,
  webFrame,
  desktopCapturer,
  deprecate,
}`],
  ]);

  // When `electron` files or folders exist in the root directory, it will cause Vite to incorrectly splicing the `/@fs/` prefix.
  // Here, use `\0` prefix avoid this behavior
  const prefix = '\0';

  return {
    name: 'vite-plugin-electron-renderer:use-node.js',
    // Bypassing Vite's builtin 'vite:resolve' plugin
    enforce: 'pre',
    // 🚧 Must be use config hook
    config(config, _env) {
      env = _env;

      // https://github.com/vitejs/vite/blob/53799e1cced7957f9877a5b5c9b6351b48e216a7/packages/vite/src/node/config.ts#L439-L442
      const root = normalizePath(config.root ? path.resolve(config.root) : process.cwd());
      const resolved = resolveModules(root, options);

      builtins.push(...resolved.builtins);
      dependencies.push(...resolved.dependencies);
      ESM_deps.push(...resolved.ESM_deps);
      CJS_modules.push(...builtins.concat(dependencies));

      if (env.command === 'serve') {
        if (!config.resolve) config.resolve = {};
        if (!config.resolve.conditions) config.resolve.conditions = ['node'];

        if (!config.optimizeDeps) config.optimizeDeps = {};
        if (!config.optimizeDeps.exclude) config.optimizeDeps.exclude = [];
        if (!config.optimizeDeps.exclude.includes('electron')) config.optimizeDeps.exclude.push('electron');

        return config;
      }

      if (env.command === 'build') {
        // Rollup ---- init ----
        if (!config.build) config.build = {};
        if (!config.build.rollupOptions) config.build.rollupOptions = {};
        if (!config.build.rollupOptions.output) config.build.rollupOptions.output = {};

        // Rollup ---- external ----
        let external = config.build.rollupOptions.external;
        if (
          Array.isArray(external) ||
          typeof external === 'string' ||
          external instanceof RegExp
        ) {
          external = CJS_modules.concat(external);
        } else if (typeof external === 'function') {
          const original = external;
          external = function (source, importer, isResolved) {
            if (CJS_modules.includes(source)) {
              return true;
            }
            return original(source, importer, isResolved);
          };
        } else {
          external = CJS_modules;
        }
        config.build.rollupOptions.external = external;

        // Rollup ---- output.format ----
        const output = config.build.rollupOptions.output;
        if (Array.isArray(output)) {
          for (const o of output) {
            if (o.format === undefined) o.format = 'cjs';
          }
        } else {
          // external modules such as `electron`, `fs`
          // they can only be loaded normally on CommonJs
          if (output.format === undefined) output.format = 'cjs';
        }

        return config;
      }

    },
    resolveId(source) {
      if (env.command === 'serve') {
        if (ESM_deps.includes(source)) return; // by vite-plugin-esmodule
        if (CJS_modules.includes(source)) return prefix + source;
      }
    },
    load(id) {
      if (env.command === 'serve') {
        /** 
         * ```
         * 🎯 Using Node.js packages(CJS) in Electron-Renderer(vite serve)
         * 
         * ┏———————————————————————————————┓                                ┏—————————————————┓
         * │ import { readFile } from 'fs' │                                │ Vite dev server │
         * ┗———————————————————————————————┛                                ┗—————————————————┛
         *                │                                                          │
         *                │ 1. HTTP(Request): fs module                              │
         *                │ ———————————————————————————————————————————————————————> │
         *                │                                                          │
         *                │                                                          │
         *                │ 2. Intercept in load-hook(vite-plugin-electron-renderer) │
         *                │ 3. Generate a virtual module(fs)                         │
         *                │    ↓                                                     │
         *                │    const _M_ = require('fs')                             │
         *                │    export const readFile = _M_.readFile                  │
         *                │                                                          │
         *                │                                                          │
         *                │ 4. HTTP(Response): fs module                             │
         *                │ <——————————————————————————————————————————————————————— │
         *                │                                                          │
         * ┏———————————————————————————————┓                                ┏—————————————————┓
         * │ import { readFile } from 'fs' │                                │ Vite dev server │
         * ┗———————————————————————————————┛                                ┗—————————————————┛
         * 
         * ```
         */

        id = id.replace(prefix, '')
        if (CJS_modules.includes(id)) {
          const cache = moduleCache.get(id);
          if (cache) return cache;

          const nodeModule = require(id);
          const requireModule = `const _M_ = require("${id}");`;
          const exportDefault = `const _D_ = _M_.default || _M_;\nexport { _D_ as default };`;
          const exportMembers = Object
            .keys(nodeModule)
            .filter(n => n !== 'default')
            .map(attr => `export const ${attr} = _M_.${attr};`).join('\n')
          const nodeModuleCodeSnippet = `
  ${requireModule}
  ${exportDefault}
  ${exportMembers}
  `.trim();

          moduleCache.set(id, nodeModuleCodeSnippet);
          return nodeModuleCodeSnippet;
        }
      }

    },
  };
};

/**
 * @type {import('.').ResolveModules}
 */
function resolveModules(root, options = {}) {
  const cwd = process.cwd();
  const builtins = builtinModules.filter(e => !e.startsWith('_')); builtins.push('electron', ...builtins.map(m => `node:${m}`));
  // dependencies of package.json
  let dependencies = [];
  // dependencies(ESM) of package.json
  const ESM_deps = [];

  // Resolve package.json dependencies
  const pkgId = lookupFile('package.json', [root, cwd])
  if (pkgId) {
    const pkg = require(pkgId);
    for (const npmPkg of Object.keys(pkg.dependencies || {})) {
      const _pkgId = lookupFile(
        'package.json',
        [root, cwd].map(r => `${r}/node_modules/${npmPkg}`),
      );
      if (_pkgId) {
        const _pkg = require(_pkgId);
        if (_pkg.type === 'module') {
          ESM_deps.push(npmPkg);
          continue;
        }
      }

      // TODO: Nested package name, but you can explicity include it by `options.resolve`
      dependencies.push(npmPkg);
    }
  }

  if (options.resolve) {
    const tmp = options.resolve(dependencies);
    if (tmp) dependencies = tmp;
  }

  return {
    builtins,
    dependencies,
    ESM_deps,
  };
}

/**
 * @type {(filename: string, paths: string[]) => string | undefined}
 */
function lookupFile(filename, paths) {
  for (const p of paths) {
    const filepath = path.join(p, filename);
    if (fs.existsSync(filepath)) {
      return filepath;
    }
  }
}

useNodeJs.resolveModules = resolveModules;
// useNodeJs.default = useNodeJs;
// ↓
// Function {
//   default: <ref *1> [Function: useNodeJs] {
//     resolveModules: [Function: resolveModules2],
//     default: [Circular *1]
//   },
//   resolveModules: [Getter]
// }
module.exports = useNodeJs;
