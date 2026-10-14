import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { builtinModules } from 'node:module'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { loadPackageJSONSync } from 'local-pkg'
import { mergeConfig, version } from 'vite'
import type { InlineConfig, Logger, ResolvedConfig, ViteDevServer } from 'vite'

import type { ElectronOptions } from '.'

export function toArray<T>(item: T | T[] | undefined): T[] {
  if (item === undefined) {
    return []
  }
  return Array.isArray(item) ? item : [item]
}

function resolveBuiltinExternals(
  external: RolldownOrRollupOptions['external'],
): RolldownOrRollupOptions['external'] {
  const nodeProtocolRE = /^node:/
  const builtins: (string | RegExp)[] = [
    'electron',
    'electron/main',
    'electron/renderer',
    'electron/common',
    'electron/utility',
    'original-fs',
    ...builtinModules,
    nodeProtocolRE,
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
      if (builtins.includes(source) || nodeProtocolRE.test(source)) {
        return true
      }
      return original(source, importer, isResolved)
    }
  }

  return builtins
}

/**
 * Normalize the build config key for the current Vite version.
 * Vite 8+ reads `build.rolldownOptions`, while Vite < 8 reads `build.rollupOptions`.
 */
function getBuildOptions(build: InlineConfig['build']): RolldownOrRollupOptions | undefined {
  if (!build) {
    return
  }
  return build.rolldownOptions || build.rollupOptions
}

function ensureBuildOptions(build: NonNullable<InlineConfig['build']>): RolldownOrRollupOptions {
  const options = getBuildOptions(build) || {}
  if (!build.rolldownOptions && !build.rollupOptions) {
    build.rolldownOptions = options
  }
  return options
}

/**
 * Keep only the build config key supported by the current Vite version.
 * This converts the user-facing config shape between `rolldownOptions` and `rollupOptions`
 * without changing the actual option payload.
 */
function setBuildOptions(build: InlineConfig['build'], viteVersion: string = version): void {
  if (!build) {
    return
  }
  const options = getBuildOptions(build)

  if (options) {
    if (Number.parseInt(viteVersion) < 8) {
      delete build.rolldownOptions
      build.rollupOptions = options
      for (const output of toArray(options.output)) {
        // Rollup doesn't support `output.codeSplitting`. Map to its inverse `output.inlineDynamicImports`.
        if (typeof output.codeSplitting === 'boolean') {
          output.inlineDynamicImports = !output.codeSplitting
        }
      }
    } else {
      delete build.rollupOptions
      build.rolldownOptions = options
    }
  }
}

export function compatRollupOptions(
  options: NonNullable<InlineConfig['build']>,
  viteVersion: string = version,
): InlineConfig['build'] {
  setBuildOptions(options, viteVersion)
  return options
}

export function checkESModule(root?: string): boolean {
  return loadPackageJSONSync(root)?.type === 'module'
}

export function createDefaultPreloadConfig(
  esmodule: boolean,
  input?: RolldownOrRollupOptions['input'],
): InlineConfig {
  const fileExt = esmodule ? 'mjs' : 'js'

  return {
    build: compatRollupOptions({
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
    }),
  }
}

export interface ElectronViteDefaultsOptions {
  entry?: ElectronOptions['entry']
  input?: RolldownOrRollupOptions['input']
  plugins?: RolldownOrRollupOptions['plugins']
  external?: RolldownOrRollupOptions['external']
  resolve?: InlineConfig['resolve']
}

export function createElectronViteDefaults(
  esmodule = false,
  options: ElectronViteDefaultsOptions = {},
): InlineConfig {
  return {
    build: compatRollupOptions({
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
        ...(options.external !== undefined ? { external: options.external } : {}),
      },
    }),
    resolve: {
      conditions: ['node'],
      // #98
      // Since we're building for electron (which uses Node.js), we don't want to use the "browser" field in the packages.
      // It corrupts bundling packages like `ws` and `isomorphic-ws`, for example.
      mainFields: ['module', 'jsnext:main', 'jsnext'],
      ...options.resolve,
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

/**
 * Externalize Electron and Node builtins in both build modes.
 * The build config keeps `rolldownOptions` on Vite 8+ and `rollupOptions` on Vite < 8.
 */
export function withExternalBuiltins(config: InlineConfig): InlineConfig {
  config.build ??= {}
  const buildOptions = ensureBuildOptions(config.build)
  buildOptions.external = resolveBuiltinExternals(buildOptions.external)
  setBuildOptions(config.build)

  if (config.environments) {
    for (const environment of Object.values(config.environments)) {
      environment.build ??= {}
      const environmentBuildOptions = ensureBuildOptions(environment.build)
      environmentBuildOptions.external = resolveBuiltinExternals(environmentBuildOptions.external)
      setBuildOptions(environment.build)
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

type BuildOptions = NonNullable<InlineConfig['build']>
/**
 * Build options exposed by Vite's build config in either compatibility shape.
 * This alias lets callers accept both Vite 7 and Vite 8 build key variants.
 */
export type RolldownOrRollupOptions = NonNullable<
  BuildOptions extends { rolldownOptions: infer U } ? U : BuildOptions['rollupOptions']
>

/** @see https://github.com/vitejs/vite/blob/v5.4.9/packages/vite/src/node/build.ts#L489-L504 */
export function resolveInput(
  config: ResolvedConfig,
): RolldownOrRollupOptions['input'] | string | undefined {
  const options = config.build
  const { root } = config
  const libOptions = options.lib
  const buildOptions = getBuildOptions(options)

  const resolve = (p: string) => path.resolve(root, p)
  const normalizeInput = (
    input: RolldownOrRollupOptions['input'] | string | undefined,
  ): RolldownOrRollupOptions['input'] | string | undefined => {
    if (typeof input === 'string') {
      return resolve(input)
    }

    if (Array.isArray(input)) {
      return input.map((file) => resolve(file))
    }

    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input).map(([alias, file]) => [alias, resolve(file)]),
      )
    }

    return input
  }

  const input = libOptions
    ? normalizeInput(buildOptions?.input) ||
      (typeof libOptions.entry === 'string'
        ? resolve(libOptions.entry)
        : Array.isArray(libOptions.entry)
          ? libOptions.entry.map(resolve)
          : Object.fromEntries(
              Object.entries(libOptions.entry || {}).map(([alias, file]) => [alias, resolve(file)]),
            ))
    : normalizeInput(buildOptions?.input)

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

const VITE_IS_DEV = 'VITE_IS_DEV'

export function setIsViteDev(): void {
  process.env[VITE_IS_DEV] = 'true'
}

export function getIsViteDev(): boolean {
  return ['1', 'true'].includes((process.env[VITE_IS_DEV] ?? '').trim().toLowerCase())
}

/**
 * List descendant PIDs of `pid` (not including `pid` itself).
 * Best-effort: process listings can race with exits.
 */
export function listDescendantPids(pid: number): number[] {
  if (!pid || pid <= 0) {
    return []
  }
  if (process.platform === 'win32') {
    return listWindowsDescendantPids(pid)
  }
  const result: number[] = []
  const stack = [pid]
  const seen = new Set<number>([pid])
  while (stack.length) {
    const current = stack.pop()!
    let children: number[]
    try {
      if (process.platform === 'darwin') {
        const out = execFileSync('pgrep', ['-P', String(current)], { encoding: 'utf8' })
        children = out.match(/\d+/g)?.map(Number) ?? []
      } else {
        const out = execFileSync('ps', ['-o', 'pid=', '--ppid', String(current)], {
          encoding: 'utf8',
        })
        children = out.match(/\d+/g)?.map(Number) ?? []
      }
    } catch {
      children = []
    }
    for (const child of children) {
      if (!seen.has(child)) {
        seen.add(child)
        result.push(child)
        stack.push(child)
      }
    }
  }
  return result
}

/** Parse `wmic process get ProcessId,ParentProcessId /FORMAT:CSV` into ppid -> pids. */
export function parseWindowsProcessTable(out: string): Map<number, number[]> {
  const childrenByParent = new Map<number, number[]>()
  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(',')
    if (parts.length < 3) {
      continue
    }
    const ppid = Number(parts[parts.length - 2])
    const pid = Number(parts[parts.length - 1])
    // Skip the CSV header and malformed rows; wmic lists the System Idle Process as pid 0.
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || pid <= 0) {
      continue
    }
    const list = childrenByParent.get(ppid)
    if (list) {
      list.push(pid)
    } else {
      childrenByParent.set(ppid, [pid])
    }
  }
  return childrenByParent
}

function readWindowsProcessTable(): Map<number, number[]> | undefined {
  try {
    const out = execFileSync(
      'wmic',
      ['process', 'get', 'ProcessId,ParentProcessId', '/FORMAT:CSV'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    )
    return parseWindowsProcessTable(out)
  } catch {
    return undefined
  }
}

function listWindowsDescendantPids(rootPid: number): number[] {
  const childrenByParent = readWindowsProcessTable()
  if (!childrenByParent) {
    return []
  }
  const result: number[] = []
  const stack = [rootPid]
  const seen = new Set<number>([rootPid])
  while (stack.length) {
    const current = stack.pop()!
    for (const child of childrenByParent.get(current) ?? []) {
      if (!seen.has(child)) {
        seen.add(child)
        result.push(child)
        stack.push(child)
      }
    }
  }
  return result
}

/**
 * Best-effort cleanup of processes orphaned by a direct child that already exited on its own
 * (e.g. Electron `app.quit()` / `process.exit()`), when no pre-exit snapshot exists.
 *
 * Windows keeps the dead parent's id in `ParentProcessId`, so the orphans are still findable;
 * each is tree-killed with `taskkill /T /F`. Trade-off: PIDs are reused on Windows, but this
 * runs synchronously within milliseconds of the parent's exit, so a reused `deadPid` that has
 * already spawned children of its own is very unlikely.
 *
 * POSIX re-parents orphans to init/subreaper, so they cannot be found by the dead pid; this is a
 * no-op there (plugin-initiated shutdown still reaps them via its pre-kill snapshot).
 * @returns the orphan PIDs that were targeted
 */
export function killOrphanedChildrenSync(deadPid: number): number[] {
  if (process.platform !== 'win32' || !deadPid || deadPid <= 0) {
    return []
  }
  const orphans = (readWindowsProcessTable()?.get(deadPid) ?? []).filter(
    (pid) => pid !== deadPid && pid !== process.pid,
  )
  for (const pid of orphans) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch {
      // Already gone (taskkill exit 128).
    }
  }
  return orphans
}

/**
 * Terminate `pid` and its descendants. On Windows uses `taskkill /T /F`.
 * On POSIX walks the process tree and signals leaves before parents.
 */
export function treeKillSync(pid: number, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (!pid || pid <= 0) {
    return
  }
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      })
    } catch {
      // Process may already be gone (taskkill exit 128).
    }
    return
  }
  const descendants = listDescendantPids(pid)
  for (const child of descendants.reverse()) {
    try {
      process.kill(child, signal)
    } catch {
      // Already gone.
    }
  }
  try {
    process.kill(pid, signal)
  } catch {
    // Already gone.
  }
}

/** Best-effort SIGKILL of leftover PIDs after the direct child has exited. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/**
 * Best-effort SIGKILL of leftover PIDs after the direct child has exited.
 * Waits briefly so callers observing liveness do not race kernel reaping.
 */
export function killPidsSync(pids: number[]): void {
  const targets = pids.filter((pid) => pid > 0)
  for (const pid of targets) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(pid), '/F'], {
          stdio: 'ignore',
        })
      } else {
        process.kill(pid, 'SIGKILL')
      }
    } catch {
      // Already gone.
    }
  }
  const deadline = Date.now() + 500
  const park = new Int32Array(new SharedArrayBuffer(4))
  while (Date.now() < deadline && targets.some(isPidAlive)) {
    Atomics.wait(park, 0, 0, 10)
  }
}
