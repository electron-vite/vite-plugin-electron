import fs from 'node:fs'
import path from 'node:path'

import { build } from 'vite'
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
      await build({
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

      const assetDir = path.join(rendererBuildOutDir, 'assets')
      const bundle = fs
        .readdirSync(assetDir)
        .filter((file) => file.endsWith('.js'))
        .map((file) => fs.readFileSync(path.join(assetDir, file), 'utf-8'))
        .join('\n')

      expect(bundle).toContain('requireElectron')
      expect(bundle).toContain(`avoid_parse_require("electron")`)
      expect(fs.existsSync(path.join(rendererBuildElectronOutDir, 'main.js'))).toBe(true)
    })
  })
})
