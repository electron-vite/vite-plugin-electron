import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { build, normalizePath } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import renderer, { electron as electronModuleSource } from '../src/renderer'

const rendererBuildRoot = path.join(__dirname, 'fixtures/renderer-build')
const rendererBuildOutDir = path.join(__dirname, 'dist-renderer-compat-build')
const rendererResolveBuildRoot = path.join(__dirname, 'fixtures/renderer-compat-resolve-build')
const rendererResolveCjsOutDir = path.join(__dirname, 'dist-renderer-compat-cjs')
const rendererResolveEsmOutDir = path.join(__dirname, 'dist-renderer-compat-esm')
const rendererResolveBuildCallbackOutDir = path.join(__dirname, 'dist-renderer-compat-build-callback')
const rendererCacheDir = path.join(
  rendererResolveBuildRoot,
  'node_modules',
  '.vite-electron-renderer',
)

async function cleanupRendererCompat() {
  await Promise.all([
    fs.promises.rm(rendererBuildOutDir, { recursive: true, force: true }),
    fs.promises.rm(rendererResolveCjsOutDir, { recursive: true, force: true }),
    fs.promises.rm(rendererResolveEsmOutDir, { recursive: true, force: true }),
    fs.promises.rm(rendererResolveBuildCallbackOutDir, { recursive: true, force: true }),
    fs.promises.rm(rendererCacheDir, { recursive: true, force: true }),
  ])
}

async function buildRendererFixture(options: {
  root: string
  outDir: string
  rendererOptions?: Parameters<typeof renderer>[0]
}) {
  await build({
    configFile: false,
    root: options.root,
    build: {
      outDir: options.outDir,
      emptyOutDir: true,
      minify: false,
    },
    plugins: [renderer(options.rendererOptions)],
    logLevel: 'silent',
  })
}

function readJavascriptBundle(outDir: string): string {
  const assetDir = path.join(outDir, 'assets')
  return fs
    .readdirSync(assetDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(assetDir, file), 'utf-8'))
    .join('\n')
}

function findRendererCacheFiles(): string[] {
  if (!fs.existsSync(rendererCacheDir)) {
    return []
  }

  return fs
    .readdirSync(rendererCacheDir, { recursive: true })
    .filter((entry) => typeof entry === 'string' && entry.endsWith('.cjs'))
    .map((entry) => path.join(rendererCacheDir, entry))
}

describe('src/renderer compatibility', () => {
  beforeEach(async () => {
    await cleanupRendererCompat()
  })

  afterEach(async () => {
    await cleanupRendererCompat()
  })

  it('matches the documented electron import behavior', async () => {
    await buildRendererFixture({
      root: rendererBuildRoot,
      outDir: rendererBuildOutDir,
    })

    const bundle = readJavascriptBundle(rendererBuildOutDir)

    expect(bundle).toContain('requireElectron')
    expect(bundle).toContain('vite-plugin-electron-renderer:builtin:electron')
    expect(bundle).toContain("ipcRenderer doesn't work in a Web Worker.")
  })

  it('matches the documented resolve.type=cjs module handling', async () => {
    await buildRendererFixture({
      root: rendererResolveBuildRoot,
      outDir: rendererResolveCjsOutDir,
      rendererOptions: {
        resolve: {
          'local-pkg': {
            type: 'cjs',
          },
        },
      },
    })

    const bundle = readJavascriptBundle(rendererResolveCjsOutDir)

    expect(bundle).toContain('loadPackageJSON')
    expect(bundle).not.toContain('.vite-electron-renderer/local-pkg.cjs')
    expect(findRendererCacheFiles()).toEqual([])
  })

  it('matches the documented resolve.type=esm prebundle handling', async () => {
    await buildRendererFixture({
      root: rendererResolveBuildRoot,
      outDir: rendererResolveEsmOutDir,
      rendererOptions: {
        resolve: {
          'local-pkg': {
            type: 'esm',
          },
        },
      },
    })

    const cacheFiles = findRendererCacheFiles()
    expect(cacheFiles).toHaveLength(1)

    const bundle = fs.readFileSync(cacheFiles[0], 'utf-8')
    expect(bundle).toContain('loadPackageJSON')
    expect(bundle).toContain('require("node:fs")')
  })

  it('matches the documented custom build callback behavior', async () => {
    let transformTriggered = false

    await buildRendererFixture({
      root: rendererResolveBuildRoot,
      outDir: rendererResolveBuildCallbackOutDir,
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
    expect(findRendererCacheFiles()).toHaveLength(1)
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
