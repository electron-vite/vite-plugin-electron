import fs from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import path from 'node:path'

import { resolveModule } from 'local-pkg'
import { createBuilder, mergeConfig, normalizePath } from 'vite'
import type { Plugin, UserConfig } from 'vite'

import type { RolldownOptions } from './utils'
import { withExternalBuiltins } from './utils'

const require = createRequire(import.meta.url)

const CACHE_DIR = '.vite-electron-renderer'
const NODE_MODULES_DIRNAME = 'node_modules'
const NODE_MODULES_SEGMENT = `${path.posix.sep}${NODE_MODULES_DIRNAME}${path.posix.sep}`
const RENDERER_PLUGIN_NAME = 'vite-plugin-electron-renderer'
const VIRTUAL_ID_PREFIX = '\0vite-plugin-electron-renderer:'
const BUILTIN_ID_PREFIX = `${VIRTUAL_ID_PREFIX}builtin:`
const RESOLVE_ID_PREFIX = `${VIRTUAL_ID_PREFIX}resolve:`
const RENDERER_MODULE_ID_FILTER = createIdPrefixFilter(BUILTIN_ID_PREFIX, RESOLVE_ID_PREFIX)

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
  cjs: (module: string) => string
  esm: (module: string, buildOptions?: RendererModuleBuildOptions) => Promise<string>
}

interface RendererResolveOptions {
  type: 'cjs' | 'esm'
  build?: (args: RendererModuleBuildHelpers) => Promise<string>
}

export type RendererModuleBuildOptions = Omit<
  RolldownOptions,
  'external' | 'input' | 'output' | 'platform'
>

export interface RendererOptions {
  /**
   * Explicitly tell Vite how to load modules, which is useful for C/C++ and ESM modules.
   */
  resolve?: Record<string, RendererResolveOptions>
}

interface RendererModuleLoadContext {
  root: string
  cacheDir: string
  activeResolveOptions: Map<string, RendererResolveOptions>
  moduleContents: Map<string, Promise<string>>
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

export const electron: string = `
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
      throw new Error([
        "ipcRenderer doesn't work in a Web Worker.",
        'You can see https://github.com/electron-vite/vite-plugin-electron/issues/69',
      ].join('\\n'))
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
  const moduleContents = new Map<string, Promise<string>>()

  return {
    name: RENDERER_PLUGIN_NAME,
    enforce: 'pre',
    config(config) {
      root = normalizePath(config.root ? path.resolve(config.root) : process.cwd())
      cacheDir = path.posix.join(resolveNodeModules(root) ?? root, CACHE_DIR)
      activeResolveOptions.clear()
      moduleContents.clear()

      for (const [id, resolveOptions] of Object.entries(options.resolve ?? {})) {
        activeResolveOptions.set(id, resolveOptions)
      }

      adaptElectronBuild(config)
      excludeOptimizedDeps(config, activeResolveOptions.keys())
    },
    resolveId: {
      handler(source) {
        if (builtinSet.has(source)) {
          return `${BUILTIN_ID_PREFIX}${source}`
        }

        if (activeResolveOptions.has(source)) {
          return `${RESOLVE_ID_PREFIX}${source}`
        }

        return
      },
    },
    load: {
      filter: {
        id: RENDERER_MODULE_ID_FILTER,
      },
      async handler(id) {
        if (id.startsWith(BUILTIN_ID_PREFIX)) {
          return getBuiltinModuleSnippet(id.slice(BUILTIN_ID_PREFIX.length))
        }

        return loadResolvedRendererModule(id.slice(RESOLVE_ID_PREFIX.length), {
          root,
          cacheDir,
          activeResolveOptions,
          moduleContents,
        })
      },
    },
  }
}

function adaptElectronBuild(config: UserConfig): void {
  config.base ??= './'
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
  const members = Object.getOwnPropertyNames(require(module.importId))
  if (!members.includes('default')) {
    members.push('default')
  }

  const aliases = members
    .filter((member) => javascriptKeywords.includes(member))
    .reduce<Record<string, string>>((memo, keyword) => {
      memo[keyword] = `keyword_${keyword}`
      return memo
    }, {})

  return [
    'const avoid_parse_require = require',
    `const _M_ = avoid_parse_require(${JSON.stringify(module.exportId)})`,
    ...members.map((member) => {
      const leftValue = aliases[member] ? `const ${aliases[member]}` : `export const ${member}`
      const rightValue = member === 'default' ? '_M_.default || _M_' : `_M_.${member}`
      return `${leftValue} = ${rightValue}`
    }),
    Object.keys(aliases).length > 0
      ? [
          'export {',
          ...Object.entries(aliases).map(([member, alias]) => `  ${alias} as ${member},`),
          '}',
        ].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function getBuiltinModuleSnippet(source: string): string {
  return source === 'electron'
    ? electron
    : getCjsInteropSnippet({ importId: source, exportId: source })
}

async function loadResolvedRendererModule(
  source: string,
  context: RendererModuleLoadContext,
): Promise<string | undefined> {
  const resolveOptions = context.activeResolveOptions.get(source)
  if (!resolveOptions) {
    return
  }

  const cached = context.moduleContents.get(source)
  if (cached) {
    return cached
  }

  const loaded = getResolvedRendererModuleSnippet(source, resolveOptions, context)
  context.moduleContents.set(source, loaded)

  try {
    return await loaded
  } catch (error) {
    context.moduleContents.delete(source)
    throw error
  }
}

function getResolvedRendererModuleSnippet(
  source: string,
  resolveOptions: RendererResolveOptions,
  context: Pick<RendererModuleLoadContext, 'root' | 'cacheDir'>,
): Promise<string> {
  if (resolveOptions.build) {
    return resolveOptions.build({
      cjs: (module) => getCjsInteropSnippet({ importId: module, exportId: module }),
      esm: (module, buildOptions) =>
        getPreBundleSnippet({
          module,
          outdir: context.cacheDir,
          root: context.root,
          buildOptions,
        }),
    })
  }

  if (resolveOptions.type === 'cjs') {
    return Promise.resolve(getCjsInteropSnippet({ importId: source, exportId: source }))
  }

  return getPreBundleSnippet({
    module: source,
    outdir: context.cacheDir,
    root: context.root,
  })
}

async function getPreBundleSnippet(options: {
  module: string
  outdir: string
  root: string
  buildOptions?: RendererModuleBuildOptions
}): Promise<string> {
  const outfile = path.posix.join(options.outdir, `${options.module}.cjs`)
  ensureDir(path.dirname(outfile))
  await buildRendererModuleWithRolldown({
    module: options.module,
    outfile,
    root: options.root,
    buildOptions: options.buildOptions,
  })

  return getCjsInteropSnippet({
    importId: outfile,
    exportId: ensureRelativePath(path.posix.relative(options.root, outfile)),
  })
}

async function buildRendererModuleWithRolldown(options: {
  module: string
  outfile: string
  root: string
  buildOptions?: RendererModuleBuildOptions
}): Promise<void> {
  const virtualEntryId = `${VIRTUAL_ID_PREFIX}entry:${options.module}`
  const virtualEntryFilter = createExactIdFilter(virtualEntryId)
  const buildConfig = withExternalBuiltins({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    root: options.root,
    build: {
      copyPublicDir: false,
      emptyOutDir: false,
      minify: false,
      outDir: path.dirname(options.outfile),
      sourcemap: 'inline',
      rolldownOptions: mergeConfig(
        {
          input: { entry: virtualEntryId },
          platform: 'node',
          output: {
            codeSplitting: false,
            entryFileNames: path.basename(options.outfile),
            format: 'cjs',
          },
        } satisfies Pick<RolldownOptions, 'input' | 'output' | 'platform'>,
        options.buildOptions ?? {},
      ),
    },
    plugins: [
      {
        name: `${RENDERER_PLUGIN_NAME}:prebundle-entry`,
        enforce: 'pre',
        resolveId: {
          filter: {
            id: virtualEntryFilter,
          },
          handler(id) {
            return id
          },
        },
        load: {
          filter: {
            id: virtualEntryFilter,
          },
          handler() {
            return getRendererEntryModuleSnippet(options.module)
          },
        },
      },
    ],
  })
  const builder = await createBuilder(buildConfig)

  const environment = builder.environments.client
  if (!environment) {
    throw new Error(
      `[vite-plugin-electron] Unable to create a renderer prebundle environment because builder.environments.client is undefined. Please check the Vite renderer build configuration.`,
    )
  }

  await builder.build(environment)
}

function getRendererEntryModuleSnippet(module: string): string {
  const source = JSON.stringify(module)
  return [
    `import * as moduleExports from ${source}`,
    `export * from ${source}`,
    'export default moduleExports.default ?? moduleExports',
  ].join('\n')
}

function resolveNodeModules(root: string): string | undefined {
  let current = normalizePath(root)
  while (true) {
    const nodeModulesDir = path.posix.join(current, NODE_MODULES_DIRNAME)
    if (fs.existsSync(nodeModulesDir) && fs.statSync(nodeModulesDir).isDirectory()) {
      return nodeModulesDir
    }

    const parent = path.posix.dirname(current)
    if (parent === current) {
      break
    }

    current = parent
  }

  const localPkgEntry = resolveModule('local-pkg', { paths: [root] })
  if (!localPkgEntry) {
    return
  }

  const normalizedEntry = normalizePath(localPkgEntry)
  const nodeModulesIndex = normalizedEntry.indexOf(NODE_MODULES_SEGMENT)
  if (nodeModulesIndex === -1) {
    return
  }

  return normalizedEntry.slice(0, nodeModulesIndex + NODE_MODULES_SEGMENT.length - 1)
}

function ensureRelativePath(relativePath: string): string {
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

function createExactIdFilter(id: string): RegExp {
  return new RegExp(`^${escapeRegExp(id)}$`)
}

function createIdPrefixFilter(...prefixes: string[]): RegExp {
  return new RegExp(`^(?:${prefixes.map(escapeRegExp).join('|')})`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
