import fs from 'node:fs'
import path from 'node:path'

import { build, createBuilder, normalizePath } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import electron from '../src'
import { notBundle } from '../src/plugin'
import electronSimple from '../src/simple'

const pluginNotBundle = notBundle()
pluginNotBundle.apply = undefined
const normalizingNewLineRE = /[\r\n]+/g
const mockHtmlRoot = path.join(__dirname, 'fixtures/mock-html-plugin')
const mockHtmlPath = path.join(mockHtmlRoot, 'index.html')
const mockHtmlOutDir = path.join(__dirname, 'dist-mock-html-plugin')
const mockHtmlDistPath = path.join(mockHtmlOutDir, 'index.html')
const rendererBuildRoot = path.join(__dirname, 'fixtures/renderer-build')
const rendererBuildOutDir = path.join(__dirname, 'dist-renderer-build')
const rendererBuildElectronOutDir = path.join(__dirname, 'dist-renderer-electron')
const rendererResolveBuildRoot = path.join(__dirname, 'fixtures/renderer-resolve-build')
const rendererResolveBuildOutDir = path.join(__dirname, 'dist-renderer-resolve-build')
const rendererResolveElectronOutDir = path.join(__dirname, 'dist-renderer-resolve-electron')
const rendererCacheDir = path.join(__dirname, '..', 'node_modules', '.vite-electron-renderer')
const localPkgCacheFile = path.join(rendererCacheDir, 'local-pkg.cjs')

async function cleanupMockHtml() {
  await Promise.all([
    fs.promises.rm(mockHtmlPath, { force: true }),
    fs.promises.rm(mockHtmlOutDir, { recursive: true, force: true }),
  ])
}

async function cleanupRendererBuild() {
  await Promise.all([
    fs.promises.rm(rendererBuildOutDir, { recursive: true, force: true }),
    fs.promises.rm(rendererBuildElectronOutDir, { recursive: true, force: true }),
    fs.promises.rm(rendererResolveBuildOutDir, { recursive: true, force: true }),
    fs.promises.rm(rendererResolveElectronOutDir, { recursive: true, force: true }),
    fs.promises.rm(localPkgCacheFile, { force: true }),
  ])
}

beforeEach(async () => {
  await Promise.all([cleanupMockHtml(), cleanupRendererBuild()])
  fs.mkdirSync(mockHtmlRoot, { recursive: true })
})

afterEach(async () => {
  await Promise.all([cleanupMockHtml(), cleanupRendererBuild()])
})

describe('src/plugin', () => {
  it('notBundle', async () => {
    await build({
      configFile: false,
      root: __dirname,
      build: {
        lib: {
          entry: 'fixtures/external-main.ts',
          formats: ['cjs'],
          fileName: () => 'external-main.js',
        },
        minify: false,
      },
      plugins: [pluginNotBundle],
    })

    const snapMain = fs.readFileSync(path.join(__dirname, 'dist/external-main.js'), 'utf-8')
    const normalSnapMain = snapMain.replace(normalizingNewLineRE, '\n')

    expect(normalSnapMain).toMatchSnapshot()
  })
  describe('src/index', () => {
    it('mockHtml', async () => {
      // Ensure no index.html exists before the test
      expect(fs.existsSync(mockHtmlPath)).toBe(false)

      // Pass empty array to test mock HTML lifecycle without triggering Electron builds.
      await build({
        configFile: false,
        root: mockHtmlRoot,
        build: {
          outDir: mockHtmlOutDir,
          emptyOutDir: true,
          minify: false,
        },
        plugins: electron([]),
        logLevel: 'silent',
      })

      // Both the source mock and its built copy must be cleaned up
      expect(fs.existsSync(mockHtmlPath)).toBe(false)
      expect(fs.existsSync(mockHtmlDistPath)).toBe(false)
    })
  })

  describe('src/simple', () => {
    it('builds renderer support with the built-in plugin', async () => {
      const builder = await createBuilder({
        configFile: false,
        root: rendererBuildRoot,
        build: {
          outDir: rendererBuildOutDir,
          emptyOutDir: true,
          minify: false,
        },
        plugins: await electronSimple({
          main: {
            entry: 'electron/main.ts',
            vite: {
              build: {
                outDir: path.relative(rendererBuildRoot, rendererBuildElectronOutDir),
              },
            },
          },
          renderer: {},
        }),
        logLevel: 'silent',
      })
      await builder.buildApp()

      const assetDir = path.join(rendererBuildOutDir, 'assets')
      const bundle = fs
        .readdirSync(assetDir)
        .filter((file) => file.endsWith('.js'))
        .map((file) => fs.readFileSync(path.join(assetDir, file), 'utf-8'))
        .join('\n')

      expect(bundle).toContain('requireElectron')
      expect(bundle).toContain('vite-plugin-electron-renderer:builtin:electron')
      expect(fs.existsSync(path.join(rendererBuildElectronOutDir, 'main.js'))).toBe(true)
    })

    it('prebundles custom esm renderer modules with createBuilder', async () => {
      const builder = await createBuilder({
        configFile: false,
        root: rendererResolveBuildRoot,
        build: {
          outDir: rendererResolveBuildOutDir,
          emptyOutDir: true,
          minify: false,
        },
        plugins: await electronSimple({
          main: {
            entry: 'electron/main.ts',
            vite: {
              build: {
                outDir: path.relative(rendererResolveBuildRoot, rendererResolveElectronOutDir),
              },
            },
          },
          renderer: {
            resolve: {
              'local-pkg': {
                type: 'esm',
              },
            },
          },
        }),
        logLevel: 'silent',
      })
      await builder.buildApp()

      expect(fs.existsSync(localPkgCacheFile)).toBe(true)

      const bundle = fs.readFileSync(localPkgCacheFile, 'utf-8')
      expect(bundle).toContain('loadPackageJSON')
      expect(bundle).toContain('require("node:fs")')
      expect(fs.existsSync(path.join(rendererResolveElectronOutDir, 'main.js'))).toBe(true)
    })

    it('prebundles custom renderer modules with build callback plugins', async () => {
      let transformTriggered = false

      const builder = await createBuilder({
        configFile: false,
        root: rendererResolveBuildRoot,
        build: {
          outDir: rendererResolveBuildOutDir,
          emptyOutDir: true,
          minify: false,
        },
        plugins: await electronSimple({
          main: {
            entry: 'electron/main.ts',
            vite: {
              build: {
                outDir: path.relative(rendererResolveBuildRoot, rendererResolveElectronOutDir),
              },
            },
          },
          renderer: {
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
        }),
        logLevel: 'silent',
      })
      await builder.buildApp()

      expect(transformTriggered).toBe(true)
      expect(fs.existsSync(localPkgCacheFile)).toBe(true)
      expect(fs.existsSync(path.join(rendererResolveElectronOutDir, 'main.js'))).toBe(true)
    })
  })
})
