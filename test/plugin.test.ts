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

  it('builds electron entries as custom environments', async () => {
    const root = path.join(__dirname, 'fixtures/mock-html')
    const clientOutDir = 'dist-client-environment'
    const electronOutDir = 'dist-electron-environment'
    const electronEntry = path.join(__dirname, 'fixtures/external-main.ts')
    const capturedBuildAppEnvironments: string[][] = []
    const capturedElectronEnvironments: string[] = []

    fs.rmSync(path.join(root, clientOutDir), { recursive: true, force: true })
    fs.rmSync(path.join(root, electronOutDir), { recursive: true, force: true })

    await build({
      configFile: false,
      root,
      build: {
        outDir: clientOutDir,
        emptyOutDir: true,
        minify: false,
      },
      plugins: [
        ...electron({
          entry: electronEntry,
          vite: {
            build: {
              outDir: electronOutDir,
              minify: false,
            },
            plugins: [
              {
                name: 'capture-electron-environment',
                buildStart() {
                  capturedElectronEnvironments.push(this.environment.name)
                },
              },
            ],
          },
        }),
        {
          name: 'capture-build-app-environments',
          buildApp(builder) {
            capturedBuildAppEnvironments.push(Object.keys(builder.environments))
          },
        },
      ],
      logLevel: 'silent',
    })

    expect(capturedBuildAppEnvironments).toEqual([
      expect.arrayContaining(['client', 'vite-plugin-electron-0']),
    ])
    expect(capturedElectronEnvironments).toEqual(['vite-plugin-electron-0'])
    expect(fs.existsSync(path.join(root, electronOutDir, 'external-main.js'))).toBe(true)
  })
})
