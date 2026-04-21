import fs from 'node:fs'
import path from 'node:path'

import { build, createBuilder } from 'vite'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import electron, {
  build as electronBuild,
  resolveViteConfig,
  withExternalBuiltins,
} from '../src/index'
import { notBundle } from '../src/plugin'

const pluginNotBundle = notBundle()
pluginNotBundle.apply = undefined
const normalizingNewLineRE = /[\r\n]+/g
const generatedDirs = [
  'dist',
  'dist-renderer-env',
  'dist-mock-html',
  'dist-electron-simple',
  'dist-electron-env',
  'dist-electron-dev',
]
const generatedFiles = [path.join(__dirname, 'fixtures/mock-html/index.html')]

function cleanupGeneratedDirs() {
  for (const dirName of generatedDirs) {
    fs.rmSync(path.join(__dirname, dirName), { recursive: true, force: true })
  }
}

function cleanupGeneratedFiles() {
  for (const filePath of generatedFiles) {
    fs.rmSync(filePath, { force: true })
  }
}

beforeAll(() => {
  cleanupGeneratedDirs()
  cleanupGeneratedFiles()
})
afterEach(() => {
  cleanupGeneratedDirs()
  cleanupGeneratedFiles()
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
})

describe('src/index > build()', () => {
  it('builds electron entry via build() helper and matches snapshot', async () => {
    const outDir = path.join(__dirname, 'dist-electron-simple')
    await electronBuild({
      entry: 'fixtures/electron-main.ts',
      vite: {
        configFile: false,
        root: __dirname,
        build: { outDir, emptyOutDir: true, minify: false },
        logLevel: 'silent',
      },
    })

    const output = fs.readFileSync(path.join(outDir, 'electron-main.js'), 'utf-8')
    expect(output.replace(normalizingNewLineRE, '\n')).toMatchSnapshot()
  })
})

describe('src/index > electron() plugin (build mode)', () => {
  it('builds electron entry through environment API and matches snapshot', async () => {
    const root = path.join(__dirname, 'fixtures/mock-html')
    const electronOutDir = path.join(__dirname, 'dist-electron-env')

    // createBuilder (not build()) is needed here: Vite's build() does not invoke builder.buildApp
    // that is returned by the plugin's config hook; createBuilder does.
    // The entry must be an absolute path because it is resolved relative to the builder root
    // (fixtures/mock-html), not the electron vite root.
    const viteBuilder = await createBuilder({
      configFile: false,
      root,
      build: {
        outDir: path.join(__dirname, 'dist-renderer-env'),
        emptyOutDir: true,
        minify: false,
      },
      plugins: electron([
        {
          entry: path.resolve(__dirname, 'fixtures/electron-main.ts'),
          vite: {
            build: { outDir: electronOutDir, emptyOutDir: true, minify: false },
          },
        },
      ]),
      logLevel: 'silent',
    })
    await viteBuilder.buildApp()

    const output = fs.readFileSync(path.join(electronOutDir, 'electron-main.js'), 'utf-8')
    expect(output.replace(normalizingNewLineRE, '\n')).toMatchSnapshot()
  })
})

describe('src/index > electron() plugin (dev mode / createBuilder)', () => {
  it('builds electron entry via createBuilder (dev path) and matches snapshot', async () => {
    const outDir = path.join(__dirname, 'dist-electron-dev')

    // Construct the per-entry config the same way createDevConfig / collectElectronEnvironmentEntries do,
    // then pass it to createBuilder – mirroring exactly what the dev plugin does inside configureServer.
    const entryConfig = withExternalBuiltins(
      resolveViteConfig({
        entry: 'fixtures/electron-main.ts',
        vite: {
          root: __dirname,
          // watch: null disables the file-watcher so the build completes in tests
          build: { outDir, emptyOutDir: true, minify: false, watch: null },
        },
      }),
    )

    const builder = await createBuilder({
      configFile: false,
      publicDir: false,
      root: __dirname,
      environments: {
        electron_0: {
          consumer: 'server',
          build: entryConfig.build,
          define: entryConfig.define,
          resolve: entryConfig.resolve,
        },
      },
      builder: {
        async buildApp(b) {
          for (const [name, env] of Object.entries(b.environments)) {
            if (name.startsWith('electron_')) {
              await b.build(env)
            }
          }
        },
      },
    })
    await builder.buildApp()

    const output = fs.readFileSync(path.join(outDir, 'electron-main.js'), 'utf-8')
    expect(output.replace(normalizingNewLineRE, '\n')).toMatchSnapshot()
  })
})
