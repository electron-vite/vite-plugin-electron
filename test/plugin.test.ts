import fs from 'node:fs'
import path from 'node:path'

import { build } from 'vite'
import { describe, expect, it } from 'vitest'

import electron from '../src/index'
import { notBundle } from '../src/plugin'

const pluginNotBundle = notBundle()
pluginNotBundle.apply = undefined
const normalizingNewLineRE = /[\r\n]+/g

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
})

describe('src/index', () => {
  it('mockHtml', async () => {
    const root = path.join(__dirname, 'fixtures/mock-html')
    const outDir = path.join(__dirname, 'dist-mock-html')
    const htmlPath = path.join(root, 'index.html')
    const distHtmlPath = path.join(outDir, 'index.html')

    // Ensure no index.html exists before the test
    expect(fs.existsSync(htmlPath)).toBe(false)

    // Pass empty array to test mock HTML lifecycle without triggering Electron builds.
    await build({
      configFile: false,
      root,
      build: {
        outDir,
        emptyOutDir: true,
        minify: false,
      },
      plugins: electron([]),
      logLevel: 'silent',
    })

    // Both the source mock and its built copy must be cleaned up
    expect(fs.existsSync(htmlPath)).toBe(false)
    expect(fs.existsSync(distHtmlPath)).toBe(false)
  })

  it('electron flat api uses named environments', async () => {
    const root = path.join(__dirname, 'fixtures')
    const appOutDir = path.join(__dirname, 'dist-electron-flat-app')
    const electronOutDir = path.join(__dirname, 'dist-electron-flat')

    await fs.promises.rm(appOutDir, { recursive: true, force: true })
    await fs.promises.rm(electronOutDir, { recursive: true, force: true })

    try {
      await build({
        configFile: false,
        root,
        build: {
          outDir: appOutDir,
          emptyOutDir: true,
          minify: false,
        },
        plugins: electron([
          {
            name: 'main',
            entry: 'env-main.ts',
            vite: {
              define: {
                __ENV_NAME__: JSON.stringify('flat-main'),
              },
              build: {
                minify: false,
                outDir: electronOutDir,
              },
              plugins: [
                {
                  name: 'flat-main-plugin',
                  renderChunk(code) {
                    return `/* ${this.environment.name}:flat-main */\n${code}`
                  },
                },
              ],
            },
          },
          {
            name: 'preload',
            entry: 'env-preload.ts',
            vite: {
              define: {
                __ENV_NAME__: JSON.stringify('flat-preload'),
              },
              build: {
                minify: false,
                outDir: electronOutDir,
              },
              plugins: [
                {
                  name: 'flat-preload-plugin',
                  renderChunk(code) {
                    return `/* ${this.environment.name}:flat-preload */\n${code}`
                  },
                },
              ],
            },
          },
        ]),
        logLevel: 'silent',
      })

      const mainCode = fs
        .readFileSync(path.join(electronOutDir, 'env-main.js'), 'utf-8')
        .replace(normalizingNewLineRE, '\n')
      const preloadCode = fs
        .readFileSync(path.join(electronOutDir, 'env-preload.js'), 'utf-8')
        .replace(normalizingNewLineRE, '\n')

      expect(mainCode).toContain('electron_main:flat-main')
      expect(mainCode).toContain('"flat-main"')
      expect(mainCode).not.toContain('electron_preload:flat-preload')

      expect(preloadCode).toContain('electron_preload:flat-preload')
      expect(preloadCode).toContain('"flat-preload"')
      expect(preloadCode).not.toContain('electron_main:flat-main')
    } finally {
      await fs.promises.rm(appOutDir, { recursive: true, force: true })
      await fs.promises.rm(electronOutDir, { recursive: true, force: true })
    }
  })
})
