import fs from 'node:fs'
import path from 'node:path'

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
const localPkgCacheFile = path.join(rendererCacheDir, 'local-pkg.cjs')

async function cleanupRendererCompat() {
  await Promise.all([
    fs.promises.rm(rendererBuildOutDir, { recursive: true, force: true }),
    fs.promises.rm(rendererResolveCjsOutDir, { recursive: true, force: true }),
    fs.promises.rm(rendererResolveEsmOutDir, { recursive: true, force: true }),
    fs.promises.rm(rendererResolveBuildCallbackOutDir, { recursive: true, force: true }),
    fs.promises.rm(localPkgCacheFile, { force: true }),
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
    expect(fs.existsSync(localPkgCacheFile)).toBe(false)
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

    expect(fs.existsSync(localPkgCacheFile)).toBe(true)

    const bundle = fs.readFileSync(localPkgCacheFile, 'utf-8')
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
    expect(fs.existsSync(localPkgCacheFile)).toBe(true)
  })

  it('keeps the worker ipcRenderer fallback behavior', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const moduleUrl = `data:text/javascript;base64,${Buffer.from(electronModuleSource).toString('base64')}`
      const electronModule = await import(moduleUrl)

      expect(electronModule.default).toEqual({})
      expect(errorSpy).toHaveBeenCalledWith(
        'If you need to use "electron" in the Renderer process, make sure that "nodeIntegration" is enabled in the Main process.',
      )
      expect(() => electronModule.ipcRenderer.send()).toThrowError(
        "ipcRenderer doesn't work in a Web Worker.\nYou can see https://github.com/electron-vite/vite-plugin-electron/issues/69",
      )
    } finally {
      errorSpy.mockRestore()
    }
  })
})
