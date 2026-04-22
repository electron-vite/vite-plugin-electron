import fs from 'node:fs'
import path from 'node:path'

import { build, createBuilder } from 'vite'
import type { Plugin } from 'vite'
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
  'dist-electron-env-define',
  'dist-electron-env-transform-main',
  'dist-electron-env-transform-preload',
  'dist-electron-env-close-main',
  'dist-electron-env-close-preload',
  'dist-electron-dev',
]
const generatedAbsoluteDirs = [
  path.resolve(__dirname, '../playground/flat/dist'),
  path.resolve(__dirname, '../playground/flat/dist-electron'),
]
const generatedFiles = [path.join(__dirname, 'fixtures/mock-html/index.html')]

function cleanupGeneratedDirs() {
  for (const dirName of generatedDirs) {
    fs.rmSync(path.join(__dirname, dirName), { recursive: true, force: true })
  }

  for (const dirPath of generatedAbsoluteDirs) {
    fs.rmSync(dirPath, { recursive: true, force: true })
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

  it('applies nested electron vite plugins to the target environment config', async () => {
    const root = path.join(__dirname, 'fixtures/mock-html')
    const electronOutDir = path.join(__dirname, 'dist-electron-env-define')
    const VIRTUAL_MAIN_STATUS_ID = 'virtual:test/main-status'
    const RESOLVED_VIRTUAL_MAIN_STATUS_ID = `\0${VIRTUAL_MAIN_STATUS_ID}`

    const createMainStatusPlugin = (status: string) => ({
      name: `test:main-status-${status}`,
      configResolved() {
        return undefined
      },
      resolveId(id: string) {
        if (id === VIRTUAL_MAIN_STATUS_ID) {
          return RESOLVED_VIRTUAL_MAIN_STATUS_ID
        }
      },
      load(id: string) {
        if (id !== RESOLVED_VIRTUAL_MAIN_STATUS_ID) {
          return
        }

        if (status !== 'override') {
          return
        }

        return `export const mainLoadedStatus = ${JSON.stringify(`${status}-resolved`)}`
      },
      config() {
        return {
          define: {
            __TEST_MAIN_STATUS__: JSON.stringify(status),
          },
        }
      },
      configEnvironment() {
        return {
          define: {
            __TEST_MAIN_ENV_STATUS__: JSON.stringify(status),
          },
        }
      },
    })

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
          entry: path.resolve(__dirname, 'fixtures/electron-define.ts'),
          vite: {
            build: { outDir: electronOutDir, emptyOutDir: true, minify: false },
            plugins: [createMainStatusPlugin('base'), createMainStatusPlugin('override')],
          },
        },
      ]),
      logLevel: 'silent',
    })
    await viteBuilder.buildApp()

    const output = fs.readFileSync(path.join(electronOutDir, 'electron-define.js'), 'utf-8')
    expect(output).toContain('"override"')
    expect(output).toContain('"override-resolved"')
    expect(output).not.toContain('__TEST_MAIN_STATUS__')
    expect(output).not.toContain('__TEST_MAIN_ENV_STATUS__')
  })

  it('isolates nested transform hooks per electron environment', async () => {
    const root = path.join(__dirname, 'fixtures/mock-html')
    const mainOutDir = path.join(__dirname, 'dist-electron-env-transform-main')
    const preloadOutDir = path.join(__dirname, 'dist-electron-env-transform-preload')

    const createTransformStatusPlugin = (status: string): Plugin => ({
      name: `test:transform-status-${status}`,
      transform(code, id) {
        if (!id.includes('electron-transform.ts')) {
          return
        }

        return code.replace(/['"]__TEST_TRANSFORM_STATUS__['"]/, JSON.stringify(status))
      },
    })

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
          name: 'main',
          entry: path.resolve(__dirname, 'fixtures/electron-transform.ts'),
          vite: {
            build: { outDir: mainOutDir, emptyOutDir: true, minify: false },
            plugins: [createTransformStatusPlugin('main-transform')],
          },
        },
        {
          name: 'preload',
          entry: path.resolve(__dirname, 'fixtures/electron-transform.ts'),
          vite: {
            build: { outDir: preloadOutDir, emptyOutDir: true, minify: false },
            plugins: [createTransformStatusPlugin('preload-transform')],
          },
        },
      ]),
      logLevel: 'silent',
    })
    await viteBuilder.buildApp()

    const mainOutput = fs.readFileSync(path.join(mainOutDir, 'electron-transform.js'), 'utf-8')
    const preloadOutput = fs.readFileSync(
      path.join(preloadOutDir, 'electron-transform.js'),
      'utf-8',
    )

    expect(mainOutput).toContain('"main-transform"')
    expect(mainOutput).not.toContain('"preload-transform"')
    expect(mainOutput).not.toContain('__TEST_TRANSFORM_STATUS__')
    expect(preloadOutput).toContain('"preload-transform"')
    expect(preloadOutput).not.toContain('"main-transform"')
    expect(preloadOutput).not.toContain('__TEST_TRANSFORM_STATUS__')
  })

  it('isolates nested closeBundle hooks per electron environment', async () => {
    const root = path.join(__dirname, 'fixtures/mock-html')
    const mainOutDir = path.join(__dirname, 'dist-electron-env-close-main')
    const preloadOutDir = path.join(__dirname, 'dist-electron-env-close-preload')
    const closeBundleCalls: string[] = []

    const createCloseBundlePlugin = (status: string): Plugin => ({
      name: `test:close-bundle-${status}`,
      closeBundle() {
        closeBundleCalls.push(`${status}:${this.environment.name}`)
      },
    })

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
          name: 'main',
          entry: path.resolve(__dirname, 'fixtures/electron-main.ts'),
          vite: {
            build: { outDir: mainOutDir, emptyOutDir: true, minify: false },
            plugins: [createCloseBundlePlugin('main')],
          },
        },
        {
          name: 'preload',
          entry: path.resolve(__dirname, 'fixtures/electron-main.ts'),
          vite: {
            build: { outDir: preloadOutDir, emptyOutDir: true, minify: false },
            plugins: [createCloseBundlePlugin('preload')],
          },
        },
      ]),
      logLevel: 'silent',
    })
    await viteBuilder.buildApp()

    expect([...closeBundleCalls].sort()).toEqual(['main:electron_main', 'preload:electron_preload'])
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

describe('playground/flat build outputs', () => {
  it('includes transform and closeBundle hook results in build artifacts', async () => {
    const playgroundRoot = path.resolve(__dirname, '../playground/flat')
    const distDir = path.join(playgroundRoot, 'dist')
    const distElectronDir = path.join(playgroundRoot, 'dist-electron')

    const builder = await createBuilder({
      configFile: path.join(playgroundRoot, 'vite.config.ts'),
      root: playgroundRoot,
      logLevel: 'silent',
    })
    await builder.buildApp()

    const rendererBundleName = fs
      .readdirSync(path.join(distDir, 'assets'))
      .find((filename) => filename.endsWith('.js'))
    expect(rendererBundleName).toBeTruthy()

    const rendererOutput = fs.readFileSync(
      path.join(distDir, 'assets', rendererBundleName!),
      'utf-8',
    )
    const mainOutput = fs.readFileSync(path.join(distElectronDir, 'main.js'), 'utf-8')
    const rendererCloseBundleOutput = fs.readFileSync(
      path.join(distDir, 'renderer-close-bundle.txt'),
      'utf-8',
    )
    const mainCloseBundleOutput = fs.readFileSync(
      path.join(distElectronDir, 'main-close-bundle.txt'),
      'utf-8',
    )

    expect(rendererOutput).toContain('"renderer-override-transform"')
    expect(rendererOutput).not.toContain('__FLAT_RENDERER_TRANSFORM_STATUS__')
    expect(mainOutput).toContain('"main-override-transform"')
    expect(mainOutput).not.toContain('__FLAT_MAIN_TRANSFORM_STATUS__')
    expect(rendererCloseBundleOutput).toBe('override:client')
    expect(mainCloseBundleOutput).toBe('override:electron_0')
    expect(fs.existsSync(path.join(distDir, 'main-close-bundle.txt'))).toBe(false)
    expect(fs.existsSync(path.join(distElectronDir, 'renderer-close-bundle.txt'))).toBe(false)
  })
})
