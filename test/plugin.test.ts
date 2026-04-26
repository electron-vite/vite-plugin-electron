import fs from 'node:fs'
import path from 'node:path'

import { build } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import electron from '../src'
import { notBundle } from '../src/plugin'

const pluginNotBundle = notBundle()
pluginNotBundle.apply = undefined
const normalizingNewLineRE = /[\r\n]+/g
const mockHtmlRoot = path.join(__dirname, 'fixtures/mock-html-plugin')
const mockHtmlPath = path.join(mockHtmlRoot, 'index.html')
const mockHtmlOutDir = path.join(__dirname, 'dist-mock-html-plugin')
const mockHtmlDistPath = path.join(mockHtmlOutDir, 'index.html')

async function cleanupMockHtml() {
  await Promise.all([
    fs.promises.rm(mockHtmlPath, { force: true }),
    fs.promises.rm(mockHtmlOutDir, { recursive: true, force: true }),
  ])
}

beforeEach(async () => {
  await cleanupMockHtml()
  fs.mkdirSync(mockHtmlRoot, { recursive: true })
})

afterEach(async () => {
  await cleanupMockHtml()
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
})
