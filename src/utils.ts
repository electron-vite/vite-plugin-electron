import fs from 'node:fs'
import path from 'node:path'
import cp from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { builtinModules } from 'node:module'
import {
  type BuildEnvironmentOptions,
  type InlineConfig,
  type ResolvedConfig,
  type ViteDevServer,
  mergeConfig,
} from 'vite'
import { loadPackageJSONSync } from 'local-pkg'
import type { ElectronOptions } from '.'

export interface PidTree {
  pid: number
  ppid: number
  children?: PidTree[]
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
      // @ts-ignore
      lib: options.entry && {
        entry: options.entry,
        // Since Electron(28) supports ESModule
        formats: esmodule ? ['es'] : ['cjs'],
        fileName: () => '[name].js',
      },
      outDir: 'dist-electron',
      // Avoid multiple entries affecting each other
      emptyOutDir: false,
    },
    resolve: {
      // @ts-ignore
      browserField: false,
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

export function withExternalBuiltins(config: InlineConfig): InlineConfig {
  const builtins = builtinModules.filter(e => !e.startsWith('_')); builtins.push('electron', ...builtins.map(m => `node:${m}`))

  config.build ??= {}
  config.build.rolldownOptions ??= {}

  let external = config.build.rolldownOptions.external
  if (
    Array.isArray(external) ||
    typeof external === 'string' ||
    external instanceof RegExp
  ) {
    external = builtins.concat(external as string[])
  } else if (typeof external === 'function') {
    const original = external
    external = function (source, importer, isResolved) {
      if (builtins.includes(source)) {
        return true
      }
      return original(source, importer, isResolved)
    }
  } else {
    external = builtins
  }
  config.build.rolldownOptions.external = external

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
  const wildcardHosts = new Set([
    '0.0.0.0',
    '::',
    '0000:0000:0000:0000:0000:0000:0000:0000',
  ])

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
    const url = path.startsWith('http')
      ? path
      : `${protocol}://${hostname}:${port}${path}`

    return url
  }
}

export type RolldownOptions = Exclude<BuildEnvironmentOptions['rolldownOptions'], undefined>

/** @see https://github.com/vitejs/vite/blob/v5.4.9/packages/vite/src/node/build.ts#L489-L504 */
export function resolveInput(config: ResolvedConfig): RolldownOptions['input'] | string | undefined {
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
          Object.entries(libOptions.entry).map(([alias, file]) => [
            alias,
            resolve(file),
          ]),
        ))
    : options.rolldownOptions?.input

  if (input) return input

  const indexHtml = resolve('index.html')
  return fs.existsSync(indexHtml) ? indexHtml : undefined
}

/**
 * When run the `vite build` command, there must be an entry file.
 * If the user does not need Renderer, we need to create a temporary entry file to avoid Vite throw error.
 * @inspired https://github.com/vitejs/vite/blob/v5.4.9/packages/vite/src/node/config.ts#L1234-L1236
 */
export async function mockIndexHtml(config: ResolvedConfig): Promise<{ remove(): Promise<void>; filepath: string; distpath: string }> {
  const { root, build } = config
  const output = path.resolve(root, build.outDir)
  const content = `
<!doctype html>
<html lang="en">
  <head>
    <title>vite-plugin-electron</title>
  </head>
  <body>
    <div>An entry file for electron renderer process.</div>
  </body>
</html>
`.trim()
  const index = 'index.html'
  const filepath = path.join(root, index)
  const distpath = path.join(output, index)

  await fs.promises.writeFile(filepath, content)

  return {
    async remove() {
      await fs.promises.unlink(filepath)
      await fs.promises.unlink(distpath)
    },
    filepath,
    distpath,
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
  const command = process.platform === 'darwin'
    ? `pgrep -P ${tree.pid}` // Mac
    : `ps -o pid --no-headers --ppid ${tree.ppid}` // Linux

  try {
    const childs = cp
      .execSync(command, { encoding: 'utf8' })
      .match(/\d+/g)
      ?.map(id => +id)

    if (childs) {
      tree.children = childs.map(cid => pidTree({ pid: cid, ppid: tree.pid }))
    }
  } catch { }

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
  } catch { /* empty */ }
}
