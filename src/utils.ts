import cp from 'node:child_process'
import fs from 'node:fs'
import { builtinModules } from 'node:module'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { loadPackageJSONSync } from 'local-pkg'
import { mergeConfig } from 'vite'
import type {
  BuildEnvironmentOptions,
  EnvironmentOptions,
  InlineConfig,
  Logger,
  ResolvedConfig,
  ViteDevServer,
} from 'vite'

import type { ElectronOptions } from './index'

export interface PidTree {
  pid: number
  ppid: number
  children?: PidTree[]
}

function resolveBuiltinExternals(
  external: RolldownOptions['external'],
): RolldownOptions['external'] {
  const builtins = builtinModules.filter((e) => !e.startsWith('_'))
  builtins.push('electron', ...builtins.map((m) => `node:${m}`))

  if (Array.isArray(external) || typeof external === 'string' || external instanceof RegExp) {
    return builtins.concat(external as string[])
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

/** Resolve the default Vite's `InlineConfig` for build Electron-Main */
export function resolveViteConfig(options: ElectronOptions): InlineConfig {
  const packageJson = loadPackageJSONSync() ?? {}
  const esmodule = packageJson.type === 'module'
  const defaultConfig: InlineConfig = {
    // 🚧 Avoid recursive build caused by load config file
    configFile: false,
    publicDir: false,

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

  return mergeConfig(defaultConfig, options?.vite || {})
}

/** Resolve the default Vite `EnvironmentOptions` for a named Electron build environment. */
export function resolveViteEnvironmentConfig(
  isESM: boolean,
  options: {
    entry?: import('vite').LibraryOptions['entry']
    options?: EnvironmentOptions
  },
): EnvironmentOptions {
  const defaultConfig: EnvironmentOptions = {
    consumer: 'server',
    build: {
      lib: options.entry
        ? {
            entry: options.entry,
            formats: isESM ? ['es'] : ['cjs'],
            fileName: () => '[name].js',
          }
        : undefined,
      outDir: 'dist-electron',
      emptyOutDir: false,
    },
    resolve: {
      conditions: ['node'],
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
    define: {
      'process.env': 'process.env',
    },
  }

  return mergeConfig(defaultConfig, options.options || {})
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
