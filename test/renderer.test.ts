import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getPackageInfoSync } from 'local-pkg'
import { build, normalizePath } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import renderer, { electron as electronModuleSource } from '../src/renderer'

const rendererBuildFixtureRoot = path.join(__dirname, 'fixtures/renderer-build')
const rendererResolveFixtureRoot = path.join(__dirname, 'fixtures/renderer-compat-resolve-build')
const rendererWorkspaceDirs = new Set<string>()

async function cleanupRendererCompat() {
  await Promise.all(
    [...rendererWorkspaceDirs].map(async (workspaceDir) => {
      rendererWorkspaceDirs.delete(workspaceDir)
      await fs.promises.rm(workspaceDir, { recursive: true, force: true })
    }),
  )
}

async function buildRendererFixture(options: {
  fixtureRoot: string
  rendererOptions?: Parameters<typeof renderer>[0]
}) {
  const workspace = await createRendererFixtureWorkspace(options.fixtureRoot)

  await build({
    configFile: false,
    root: workspace.root,
    build: {
      outDir: workspace.outDir,
      emptyOutDir: true,
      minify: false,
    },
    plugins: [renderer(options.rendererOptions)],
    logLevel: 'silent',
  })

  return workspace
}

function readJavascriptBundle(outDir: string): string {
  const assetDir = path.join(outDir, 'assets')
  return fs
    .readdirSync(assetDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(assetDir, file), 'utf-8'))
    .join('\n')
}

function findRendererCacheFiles(cacheDir: string): string[] {
  if (!fs.existsSync(cacheDir)) {
    return []
  }

  return fs
    .readdirSync(cacheDir, { recursive: true })
    .filter((entry) => typeof entry === 'string' && entry.endsWith('.cjs'))
    .map((entry) => path.join(cacheDir, entry))
}

async function createRendererFixtureWorkspace(fixtureRoot: string) {
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-electron-renderer-'))
  rendererWorkspaceDirs.add(workspaceRoot)
  await fs.promises.cp(fixtureRoot, workspaceRoot, { recursive: true })
  await ensureRendererFixtureNodeModules(workspaceRoot)

  return {
    root: workspaceRoot,
    outDir: path.join(workspaceRoot, 'dist'),
    cacheDir: path.join(workspaceRoot, 'node_modules', '.vite-electron-renderer'),
  }
}

async function ensureRendererFixtureNodeModules(root: string) {
  const localPkgInfo = getPackageInfoSync('local-pkg', { paths: [__dirname] })
  if (!localPkgInfo) {
    throw new Error('Unable to resolve local-pkg for renderer compatibility tests.')
  }

  const fixtureNodeModulesDir = path.join(root, 'node_modules')
  const fixtureLocalPkgPath = path.join(fixtureNodeModulesDir, 'local-pkg')
  await fs.promises.mkdir(fixtureNodeModulesDir, { recursive: true })
  await fs.promises.rm(fixtureLocalPkgPath, { recursive: true, force: true })
  await fs.promises.symlink(
    localPkgInfo.rootPath,
    fixtureLocalPkgPath,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
}

describe.sequential('src/renderer compatibility', () => {
  beforeEach(async () => {
    await cleanupRendererCompat()
  })

  afterEach(async () => {
    await cleanupRendererCompat()
  })

  it('matches the documented electron import behavior', async () => {
    const workspace = await buildRendererFixture({
      fixtureRoot: rendererBuildFixtureRoot,
    })

    const bundle = readJavascriptBundle(workspace.outDir)

    expect(bundle).toContain('requireElectron')
    expect(bundle).toContain('vite-plugin-electron-renderer:builtin:electron')
    expect(bundle).toContain("ipcRenderer doesn't work in a Web Worker.")
  })

  it('matches the documented resolve.type=cjs module handling', async () => {
    const workspace = await buildRendererFixture({
      fixtureRoot: rendererResolveFixtureRoot,
      rendererOptions: {
        resolve: {
          'local-pkg': {
            type: 'cjs',
          },
        },
      },
    })

    const bundle = readJavascriptBundle(workspace.outDir)

    expect(bundle).toContain('loadPackageJSON')
    expect(bundle).not.toContain('.vite-electron-renderer/local-pkg.cjs')
    expect(findRendererCacheFiles(workspace.cacheDir)).toEqual([])
  })

  it('matches the documented resolve.type=esm prebundle handling', async () => {
    const workspace = await buildRendererFixture({
      fixtureRoot: rendererResolveFixtureRoot,
      rendererOptions: {
        resolve: {
          'local-pkg': {
            type: 'esm',
          },
        },
      },
    })

    const cacheFiles = findRendererCacheFiles(workspace.cacheDir)
    expect(cacheFiles).toHaveLength(1)

    const bundle = fs.readFileSync(cacheFiles[0], 'utf-8')
    expect(bundle).toContain('loadPackageJSON')
    expect(bundle).toContain('require("node:fs")')
  })

  it('matches the documented custom build callback behavior', async () => {
    let transformTriggered = false

    const workspace = await buildRendererFixture({
      fixtureRoot: rendererResolveFixtureRoot,
      rendererOptions: {
        resolve: {
          'local-pkg': {
            type: 'esm',
            build: ({ esm }) =>
              esm('local-pkg', {
                plugins: [
                  {
                    name: 'renderer-build-callback-transform',
                    transform(code, id) {
                      if (normalizePath(id).includes('/node_modules/local-pkg/')) {
                        transformTriggered = true
                      }

                      return code
                    },
                  },
                ],
              }),
          },
        },
      },
    })

    expect(transformTriggered).toBe(true)
    expect(findRendererCacheFiles(workspace.cacheDir)).toHaveLength(1)
  })

  it('keeps the worker ipcRenderer fallback behavior', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vite-plugin-electron-renderer-'))
    const tempModulePath = path.join(tempDir, 'electron-worker.mjs')

    try {
      await fs.promises.writeFile(
        tempModulePath,
        `const require = undefined\n${electronModuleSource}`,
        'utf-8',
      )

      const electronModule = await import(pathToFileURL(tempModulePath).href)

      expect(electronModule.default).toEqual({})
      expect(errorSpy).toHaveBeenCalledWith(
        'If you need to use "electron" in the Renderer process, make sure that "nodeIntegration" is enabled in the Main process.',
      )
      for (const method of ['send', 'on', 'once', 'invoke'] as const) {
        expect(() => electronModule.ipcRenderer[method]()).toThrowError(
          "ipcRenderer doesn't work in a Web Worker.\nYou can see https://github.com/electron-vite/vite-plugin-electron/issues/69",
        )
      }
    } finally {
      errorSpy.mockRestore()
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    }
  })
})
