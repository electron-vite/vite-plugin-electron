import cp from 'node:child_process'
import fs from 'node:fs'
import { builtinModules } from 'node:module'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { loadPackageJSONSync } from 'local-pkg'
import { mergeConfig } from 'vite'
import type {
  BuildEnvironmentOptions,
  InlineConfig,
  Logger,
  ResolvedConfig,
  ViteDevServer,
} from 'vite'

import type { ElectronOptions } from '.'

export interface PidTree {
  pid: number
  ppid: number
  children?: PidTree[]
}

function resolveBuiltinExternals(
  external: RolldownOptions['external'],
): RolldownOptions['external'] {
  const builtins: (string | RegExp)[] = [
    'electron',
    'electron/main',
    'electron/renderer',
    'electron/common',
    'electron/utility',
    ...builtinModules,
    /^node:/,
  ]

  if (Array.isArray(external)) {
    return builtins.concat(external)
  }

  if (typeof external === 'string' || external instanceof RegExp) {
    return builtins.concat([external])
  }

  if (typeof external === 'function') {
    const original = external
    return function (source, importer, isResolved) {
      if (builtins.includes(source)) {
        return true
      }
      return original(source, importer, isResolved)
    }
  }

  return builtins
}

export function checkESModule(): boolean {
  return loadPackageJSONSync()?.type === 'module'
}

export const defaultMainSimpleConfig: InlineConfig = {
  build: {
    rolldownOptions: {
      platform: 'node',
    },
  },
}

export function createDefaultPreloadConfig(
  esmodule: boolean,
  input?: RolldownOptions['input'],
): InlineConfig {
  const fileExt = esmodule ? 'mjs' : 'js'

  return {
    build: {
      rolldownOptions: {
        // `rolldownOptions.input` has higher priority than `build.lib`.
        // @see - https://github.com/vitejs/vite/blob/v5.0.9/packages/vite/src/node/build.ts#L482
        input,
        platform: 'node',
        output: {
          // In most cases, use `cjs` format
          format: 'cjs',
          // `require()` can usable matrix
          //  @see - https://github.com/electron/electron/blob/v30.0.0-nightly.20240104/docs/tutorial/esm.md#preload-scripts
          //  ┏———————————————————————————————————┳——————————┳———————————┓
          //  │ webPreferences: { }               │  import  │  require  │
          //  ┠———————————————————————————————————╂——————————╂———————————┨
          //  │ nodeIntegration: false(undefined) │    ✘     │     ✔     │
          //  ┠———————————————————————————————————╂——————————╂———————————┨
          //  │ nodeIntegration: true             │    ✔     │     ✔     │
          //  ┠———————————————————————————————————╂——————————╂———————————┨
          //  │ sandbox: true(undefined)          │    ✘     │     ✔     │
          //  ┠———————————————————————————————————╂——————————╂———————————┨
          //  │ sandbox: false                    │    ✔     │     ✘     │
          //  ┠———————————————————————————————————╂——————————╂———————————┨
          //  │ nodeIntegration: false            │    ✘     │     ✔     │
          //  │ sandbox: true                     │          │           │
          //  ┠———————————————————————————————————╂——————————╂———————————┨
          //  │ nodeIntegration: false            │    ✔     │     ✘     │
          //  │ sandbox: false                    │          │           │
          //  ┠———————————————————————————————————╂——————————╂———————————┨
          //  │ nodeIntegration: true             │    ✘     │     ✔     │
          //  │ sandbox: true                     │          │           │
          //  ┠———————————————————————————————————╂——————————╂———————————┨
          //  │ nodeIntegration: true             │    ✔     │     ✔     │
          //  │ sandbox: false                    │          │           │
          //  ┗———————————————————————————————————┸——————————┸———————————┛
          //  - import(✘): SyntaxError: Cannot use import statement outside a module
          //  - require(✘): ReferenceError: require is not defined in ES module scope, you can use import instead
          // Note, however, that `preload.ts` should not be split. 🚧
          codeSplitting: false,
          // When Rollup builds code in `cjs` format, it will automatically split the code into multiple chunks, and use `require()` to load them,
          // and use `require()` to load other modules when `nodeIntegration: false` in the Main process Errors will occur.
          // So we need to configure Rollup not to split the code when building to ensure that it works correctly with `nodeIntegration: false`.
          // @see - https://github.com/vitejs/vite/blob/v5.0.9/packages/vite/src/node/build.ts#L608
          entryFileNames: `[name].${fileExt}`,
          chunkFileNames: `[name].${fileExt}`,
          assetFileNames: '[name].[ext]',
        },
      },
    },
  }
}

interface ElectronViteDefaultsOptions {
  entry?: ElectronOptions['entry']
  input?: RolldownOptions['input']
  plugins?: RolldownOptions['plugins']
}

export function createElectronViteDefaults(
  esmodule = false,
  options: ElectronViteDefaultsOptions = {},
): InlineConfig {
  return {
    build: {
      lib: options.entry
        ? {
            entry: options.entry,
            // Since Electron(28) supports ESModule
            formats: esmodule ? ['es'] : ['cjs'],
            fileName: () => '[name].js',
          }
        : undefined,
      outDir: 'dist-electron',
      // Avoid multiple entries affecting each other
      emptyOutDir: false,
      rolldownOptions: {
        platform: 'node',
        ...(options.input !== undefined
          ? {
              input: options.input,
              output: { format: esmodule ? 'es' : 'cjs' },
            }
          : {}),
        ...(options.plugins !== undefined ? { plugins: options.plugins } : {}),
      },
    },
    resolve: {
      conditions: ['node'],
      // #98
      // Since we're building for electron (which uses Node.js), we don't want to use the "browser" field in the packages.
      // It corrupts bundling packages like `ws` and `isomorphic-ws`, for example.
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
    define: {
      // @see - https://github.com/vitejs/vite/blob/v5.0.11/packages/vite/src/node/plugins/define.ts#L20
      'process.env': 'process.env',
    },
  }
}

/** Resolve the default Vite's `InlineConfig` for build Electron-Main */
export function resolveViteConfig(options: ElectronOptions): InlineConfig {
  return resolveViteConfigBase(checkESModule(), options)
}

/** Resolve the default Vite's `InlineConfig` for build Electron-Main */
export function resolveViteConfigBase(esmodule: boolean, options: ElectronOptions): InlineConfig {
  const defaultConfig = createElectronViteDefaults(esmodule, { entry: options.entry })
  // 🚧 Avoid recursive build caused by load config file
  defaultConfig.configFile = false
  defaultConfig.publicDir = false

  return mergeConfig(defaultConfig, options?.vite || {})
}

export function withExternalBuiltins(config: InlineConfig): InlineConfig {
  config.build ??= {}
  config.build.rolldownOptions ??= {}
  config.build.rolldownOptions.external = resolveBuiltinExternals(
    config.build.rolldownOptions.external,
  )

  if (config.environments) {
    for (const environment of Object.values(config.environments)) {
      environment.build ??= {}
      environment.build.rolldownOptions ??= {}
      environment.build.rolldownOptions.external = resolveBuiltinExternals(
        environment.build.rolldownOptions.external,
      )
    }
  }

  return config
}

/**
 * @see https://github.com/vitejs/vite/blob/v4.0.1/packages/vite/src/node/constants.ts#L137-L147
 */
export function resolveHostname(hostname: string): string {
  const loopbackHosts = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    '0000:0000:0000:0000:0000:0000:0000:0001',
  ])
  const wildcardHosts = new Set(['0.0.0.0', '::', '0000:0000:0000:0000:0000:0000:0000:0000'])

  return loopbackHosts.has(hostname) || wildcardHosts.has(hostname) ? 'localhost' : hostname
}

export function resolveServerUrl(server: ViteDevServer): string | undefined {
  const addressInfo = server.httpServer?.address()
  const isAddressInfo = (x: any): x is AddressInfo => x?.address

  if (isAddressInfo(addressInfo)) {
    const { address, port } = addressInfo
    const hostname = resolveHostname(address)

    const options = server.config.server
    const protocol = options.https ? 'https' : 'http'
    const devBase = server.config.base

    const path = typeof options.open === 'string' ? options.open : devBase
    const url = path.startsWith('http') ? path : `${protocol}://${hostname}:${port}${path}`

    return url
  }
}

export type RolldownOptions = Exclude<BuildEnvironmentOptions['rolldownOptions'], undefined>

/** @see https://github.com/vitejs/vite/blob/v5.4.9/packages/vite/src/node/build.ts#L489-L504 */
export function resolveInput(
  config: ResolvedConfig,
): RolldownOptions['input'] | string | undefined {
  const options = config.build
  const { root } = config
  const libOptions = options.lib

  const resolve = (p: string) => path.resolve(root, p)
  const input = libOptions
    ? options.rolldownOptions?.input ||
      (typeof libOptions.entry === 'string'
        ? resolve(libOptions.entry)
        : Array.isArray(libOptions.entry)
          ? libOptions.entry.map(resolve)
          : Object.fromEntries(
              Object.entries(libOptions.entry).map(([alias, file]) => [alias, resolve(file)]),
            ))
    : options.rolldownOptions?.input

  if (input) {
    return input
  }

  const indexHtml = resolve('index.html')
  return fs.existsSync(indexHtml) ? indexHtml : undefined
}

const MOCK_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>vite-plugin-electron</title>
  </head>
  <body>
    <div>An entry file for electron renderer process.</div>
  </body>
</html>`

/**
 * Write a temporary mock `index.html` at `filepath` so that Vite has a valid
 * entry point when no real `index.html` and no configured input exist.
 *
 * Returns an async cleanup function.  Before removing the file it re-reads the
 * content and skips deletion when another plugin or tool has replaced the file
 * in the meantime, guarding against accidental removal of real HTML written in
 * parallel.
 */
export function setupMockHtml(
  config: ResolvedConfig,
  isBuild: boolean,
  logger: Logger,
): () => Promise<void> {
  const { root, build: buildConfig } = config
  const mockFilepath = path.join(root, 'index.html')
  const distFilepath = path.resolve(root, buildConfig.outDir, 'index.html')
  logger.info(`[vite-plugin-electron] No entry found, writing mock ${mockFilepath}`)
  fs.writeFileSync(mockFilepath, MOCK_INDEX_HTML, 'utf-8')
  return async () => {
    const current = await fs.promises.readFile(mockFilepath, 'utf-8').catch(() => null)
    if (current === MOCK_INDEX_HTML) {
      await fs.promises.unlink(mockFilepath).catch((err) => {
        logger.warn(`[vite-plugin-electron] Failed to remove mock ${mockFilepath}:`, err)
      })
    }
    if (isBuild && distFilepath) {
      // The dist copy was produced from our mock; remove it silently.
      await fs.promises.unlink(distFilepath).catch(() => {})
    }
  }
}

/**
 * Inspired `tree-kill`, implemented based on sync-api. #168
 * @see https://github.com/pkrumins/node-tree-kill/blob/v1.2.2/index.js
 */
export function treeKillSync(pid: number): void {
  if (process.platform === 'win32') {
    cp.execSync(`taskkill /pid ${pid} /T /F`)
  } else {
    killTree(pidTree({ pid, ppid: process.pid }))
  }
}

function pidTree(tree: PidTree) {
  const command =
    process.platform === 'darwin'
      ? `pgrep -P ${tree.pid}` // Mac
      : `ps -o pid --no-headers --ppid ${tree.ppid}` // Linux

  try {
    const childs = cp
      .execSync(command, { encoding: 'utf8' })
      .match(/\d+/g)
      ?.map((id) => +id)

    if (childs) {
      tree.children = childs.map((cid) => pidTree({ pid: cid, ppid: tree.pid }))
    }
  } catch {}

  return tree
}

function killTree(tree: PidTree) {
  if (tree.children) {
    for (const child of tree.children) {
      killTree(child)
    }
  }

  try {
    process.kill(tree.pid) // #214
  } catch {}
}
