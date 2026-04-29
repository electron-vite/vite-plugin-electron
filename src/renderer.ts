import fs from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import type { BuildOptions as EsbuildBuildOptions } from 'esbuild'
import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

const require = createRequire(import.meta.url)

const CACHE_DIR = '.vite-electron-renderer'
const RENDERER_PLUGIN_NAME = 'vite-plugin-electron-renderer'
const VIRTUAL_ID_PREFIX = '\0vite-plugin-electron-renderer:'
const BUILTIN_ID_PREFIX = `${VIRTUAL_ID_PREFIX}builtin:`
const RESOLVE_ID_PREFIX = `${VIRTUAL_ID_PREFIX}resolve:`

const javascriptKeywords = [
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'let',
  'static',
  'yield',
  'await',
  'enum',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'abstract',
  'boolean',
  'byte',
  'char',
  'double',
  'final',
  'float',
  'goto',
  'int',
  'long',
  'native',
  'short',
  'synchronized',
  'throws',
  'transient',
  'volatile',
  'arguments',
  'as',
  'async',
  'eval',
  'from',
  'get',
  'of',
  'set',
]

interface RendererModuleBuildHelpers {
  cjs: (module: string) => Promise<string>
  esm: (module: string, buildOptions?: EsbuildBuildOptions) => Promise<string>
}

interface RendererResolveOptions {
  type: 'cjs' | 'esm'
  build?: (args: RendererModuleBuildHelpers) => Promise<string>
}

export interface RendererOptions {
  /**
   * Explicitly tell Vite how to load modules, which is useful for C/C++ and ESM modules.
   */
  resolve?: Record<string, RendererResolveOptions>
}

const builtinSet = new Set(
  ['electron', ...builtinModules.filter((id) => !id.startsWith('_'))].flatMap((id) =>
    id.startsWith('node:') ? [id] : [id, `node:${id}`],
  ),
)

const electronMainApis = [
  { name: 'app', environments: ['Main'] },
  { name: 'autoUpdater', environments: ['Main'] },
  { name: 'BaseWindow', environments: ['Main'] },
  { name: 'BrowserView', environments: ['Main'] },
  { name: 'BrowserWindow', environments: ['Main'] },
  { name: 'clipboard', environments: ['Main', 'Renderer'] },
  { name: 'contentTracing', environments: ['Main'] },
  { name: 'crashReporter', environments: ['Main', 'Renderer'] },
  { name: 'desktopCapturer', environments: ['Main'] },
  { name: 'dialog', environments: ['Main'] },
  { name: 'globalShortcut', environments: ['Main'] },
  { name: 'inAppPurchase', environments: ['Main'] },
  { name: 'ipcMain', environments: ['Main'] },
  { name: 'Menu', environments: ['Main'] },
  { name: 'MessageChannelMain', environments: ['Main'] },
  { name: 'MessagePortMain', environments: ['Main'] },
  { name: 'nativeImage', environments: ['Main', 'Renderer'] },
  { name: 'nativeTheme', environments: ['Main'] },
  { name: 'net', environments: ['Main', 'Utility'] },
  { name: 'netLog', environments: ['Main'] },
  { name: 'Notification', environments: ['Main'] },
  { name: 'parentPort', environments: ['Utility'] },
  { name: 'powerMonitor', environments: ['Main'] },
  { name: 'powerSaveBlocker', environments: ['Main'] },
  { name: 'process', environments: ['Main', 'Renderer'] },
  { name: 'protocol', environments: ['Main'] },
  { name: 'pushNotifications', environments: ['Main'] },
  { name: 'safeStorage', environments: ['Main'] },
  { name: 'screen', environments: ['Main'] },
  { name: 'session', environments: ['Main'] },
  { name: 'ShareMenu', environments: ['Main'] },
  { name: 'shell', environments: ['Main', 'Renderer'] },
  { name: 'systemPreferences', environments: ['Main', 'Utility'] },
  { name: 'TouchBar', environments: ['Main'] },
  { name: 'Tray', environments: ['Main'] },
  { name: 'utilityProcess', environments: ['Main'] },
  { name: 'webContents', environments: ['Main'] },
  { name: 'WebContentsView', environments: ['Main'] },
  { name: 'webFrameMain', environments: ['Main'] },
  { name: 'View', environments: ['Main'] },
] as const

export const electron = `
const electron = typeof require !== 'undefined'
  ? (function requireElectron() {
    const avoid_parse_require = require
    return avoid_parse_require('electron')
  }())
  : (function nodeIntegrationWarn() {
    console.error('If you need to use "electron" in the Renderer process, make sure that "nodeIntegration" is enabled in the Main process.')
    return {}
  }())

let _ipcRenderer
if (typeof document === 'undefined') {
  _ipcRenderer = {}
  const keys = [
    'invoke',
    'postMessage',
    'send',
    'sendSync',
    'sendTo',
    'sendToHost',
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
  ]
  for (const key of keys) {
    _ipcRenderer[key] = () => {
      throw new Error(
        "ipcRenderer doesn't work in a Web Worker.\\n" +
        'You can see https://github.com/electron-vite/vite-plugin-electron/issues/69',
      )
    }
  }
} else {
  _ipcRenderer = electron.ipcRenderer
}

export { electron as default }
export const clipboard = electron.clipboard
export const contextBridge = electron.contextBridge
export const crashReporter = electron.crashReporter
export const ipcRenderer = _ipcRenderer
export const nativeImage = electron.nativeImage
export const shell = electron.shell
export const webFrame = electron.webFrame
export const deprecate = electron.deprecate
${electronMainApis
  .filter(({ environments }) => environments.length === 1 && environments[0] === 'Main')
  .map(({ name }) => `export const ${name} = electron.${name}`)
  .join('\n')}
`.trim()

export default function renderer(options: RendererOptions = {}): Plugin {
  let root = normalizePath(process.cwd())
  let cacheDir = path.posix.join(root, CACHE_DIR)
  const activeResolveOptions = new Map<string, RendererResolveOptions>()

  return {
    name: RENDERER_PLUGIN_NAME,
    enforce: 'pre',
    config(config, { command }) {
      root = normalizePath(config.root ? path.resolve(config.root) : process.cwd())
      cacheDir = path.posix.join(findNodeModules(root)[0] ?? root, CACHE_DIR)
      activeResolveOptions.clear()

      for (const [id, resolveOptions] of Object.entries(options.resolve ?? {})) {
        if (command === 'build' && resolveOptions.type === 'esm') {
          continue
        }
        activeResolveOptions.set(id, resolveOptions)
      }

      adaptElectronBuild(config)
      excludeOptimizedDeps(config, activeResolveOptions.keys())
    },
    resolveId(source) {
      if (builtinSet.has(source)) {
        return `${BUILTIN_ID_PREFIX}${source}`
      }

      if (activeResolveOptions.has(source)) {
        return `${RESOLVE_ID_PREFIX}${source}`
      }
    },
    async load(id) {
      if (id.startsWith(BUILTIN_ID_PREFIX)) {
        const source = id.slice(BUILTIN_ID_PREFIX.length)
        return source === 'electron'
          ? electron
          : getCjsInteropSnippet({ importId: source, exportId: source })
      }

      if (!id.startsWith(RESOLVE_ID_PREFIX)) {
        return
      }

      const source = id.slice(RESOLVE_ID_PREFIX.length)
      const resolveOptions = activeResolveOptions.get(source)

      if (!resolveOptions) {
        return
      }

      if (resolveOptions.build) {
        return resolveOptions.build({
          cjs: async (module) => getCjsInteropSnippet({ importId: module, exportId: module }),
          esm: (module, buildOptions) =>
            getPreBundleSnippet({
              module,
              outdir: cacheDir,
              root,
              buildOptions,
            }),
        })
      }

      if (resolveOptions.type === 'cjs') {
        return getCjsInteropSnippet({ importId: source, exportId: source })
      }

      return getPreBundleSnippet({
        module: source,
        outdir: cacheDir,
        root,
      })
    },
  }
}

function adaptElectronBuild(config: {
  base?: string
  build?: {
    rolldownOptions?: {
      output?: { freeze?: boolean } | Array<{ freeze?: boolean }>
    }
  }
}): void {
  config.base ??= './'
  config.build ??= {}
  config.build.rolldownOptions ??= {}
  setOutputFreeze(config.build.rolldownOptions)
}

function setOutputFreeze(rolldownOptions: {
  output?: { freeze?: boolean } | Array<{ freeze?: boolean }>
}): void {
  rolldownOptions.output ??= {}
  if (Array.isArray(rolldownOptions.output)) {
    for (const output of rolldownOptions.output) {
      output.freeze ??= false
    }
    return
  }
  rolldownOptions.output.freeze ??= false
}

function excludeOptimizedDeps(
  config: { optimizeDeps?: { exclude?: string[] } },
  moduleIds: Iterable<string>,
): void {
  config.optimizeDeps ??= {}
  config.optimizeDeps.exclude ??= []
  for (const moduleId of moduleIds) {
    if (!config.optimizeDeps.exclude.includes(moduleId)) {
      config.optimizeDeps.exclude.push(moduleId)
    }
  }
}

function getCjsInteropSnippet(module: { importId: string; exportId: string }): string {
  const { exports } = libEsm({
    exports: Object.getOwnPropertyNames(require(module.importId)),
  })
  return `const avoid_parse_require = require\nconst _M_ = avoid_parse_require(${JSON.stringify(module.exportId)})\n${exports}`
}

async function getPreBundleSnippet(options: {
  module: string
  outdir: string
  root: string
  buildOptions?: EsbuildBuildOptions
}): Promise<string> {
  const { build } = await import('esbuild')
  const outfile = path.posix.join(options.outdir, `${options.module}.cjs`)
  ensureDir(path.dirname(outfile))
  await build({
    entryPoints: [options.module],
    outfile,
    target: 'node20',
    format: 'cjs',
    bundle: true,
    sourcemap: 'inline',
    platform: 'node',
    external: [...builtinSet],
    ...options.buildOptions,
  })

  return getCjsInteropSnippet({
    importId: outfile,
    exportId: relativeify(path.posix.relative(options.root, outfile)),
  })
}

function libEsm(options: {
  window?: string
  require?: string
  exports?: string[]
  conflict?: string
}): {
  window: string
  require: string
  exports: string
  keywords: Record<string, string>
} {
  const {
    window,
    require: requireId,
    exports: members = [],
    conflict = '',
  } = options
  const target = `_M_${conflict}`
  const windowSnippet = window ? `const ${target} = window[${JSON.stringify(window)}]` : ''
  const requireSnippet = requireId
    ? [
        'import module from "node:module"',
        `const ${target} = module.createRequire(import.meta.url)(${JSON.stringify(requireId)})`,
      ].join('\n')
    : ''

  if (!members.includes('default')) {
    members.push('default')
  }

  const aliases = members
    .filter((member) => javascriptKeywords.includes(member))
    .reduce<Record<string, string>>((memo, keyword) => {
      memo[keyword] = `keyword_${keyword}${conflict}`
      return memo
    }, {})

  const exportsSnippet = [
    ...members.map((member) => {
      const leftValue = aliases[member] ? `const ${aliases[member]}` : `export const ${member}`
      const rightValue = member === 'default' ? `${target}.default || ${target}` : `${target}.${member}`
      return `${leftValue} = ${rightValue}`
    }),
    aliases && Object.keys(aliases).length > 0
      ? [
          'export {',
          ...Object.entries(aliases).map(([member, alias]) => `  ${alias} as ${member},`),
          '}',
        ].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  return {
    window: windowSnippet,
    require: requireSnippet,
    exports: exportsSnippet,
    keywords: aliases,
  }
}

function findNodeModules(root: string, matches: string[] = []): string[] {
  if (!root) {
    return matches
  }

  const normalizedRoot = normalizePath(root)
  const nodeModulesDir = path.posix.join(normalizedRoot, 'node_modules')
  if (fs.existsSync(nodeModulesDir) && fs.statSync(nodeModulesDir).isDirectory()) {
    matches.push(nodeModulesDir)
  }

  const parent = path.posix.dirname(normalizedRoot)
  return parent === normalizedRoot ? matches : findNodeModules(parent, matches)
}

function relativeify(relativePath: string): string {
  if (relativePath === '') {
    return '.'
  }

  return /^\.{1,2}[/\\]/.test(relativePath) ? relativePath : `./${relativePath}`
}

function ensureDir(dirname: string): void {
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true })
  }
}
