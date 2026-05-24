import fs from 'node:fs'
import path from 'node:path'

import { createBuilder } from 'vite'
import type { Plugin } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import electron, { simpleOptions } from '../src/multi-env'

const normalizingNewLineRE = /[\r\n]+/g
const mockHtmlRoot = path.join(__dirname, 'fixtures/mock-html-multi-env')
const mockHtmlPath = path.join(mockHtmlRoot, 'index.html')
const mockHtmlOutDir = path.join(__dirname, 'dist-mock-html-multi-env')
const mockHtmlDistPath = path.join(mockHtmlOutDir, 'index.html')

const cleanupDirs = new Set<string>()

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
  await Promise.all(
    [...cleanupDirs].map((dir) => fs.promises.rm(dir, { recursive: true, force: true })),
  )
  cleanupDirs.clear()
})

function trackDirs(...dirs: string[]) {
  for (const dir of dirs) {
    cleanupDirs.add(dir)
  }
}

async function resetDirs(...dirs: string[]) {
  trackDirs(...dirs)
  await Promise.all(dirs.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })))
}

function createLifecyclePlugin(label: string, logPath: string): Plugin {
  const writeLog = (hook: string, environmentName: string) => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, `${environmentName}:${label}:${hook}\n`, 'utf-8')
  }

  return {
    name: `${label}-lifecycle-plugin`,
    buildStart() {
      writeLog('buildStart', this.environment.name)
    },
    transform(code, id) {
      const basename = path.basename(id)

      if (basename !== `env-${label}.ts`) {
        return
      }

      writeLog('transform', this.environment.name)
      return `${code}\nexport const transformStatus = '${this.environment.name}:${label}:transform'`
    },
    buildEnd() {
      writeLog('buildEnd', this.environment.name)
    },
    generateBundle() {
      writeLog('generateBundle', this.environment.name)
      this.emitFile({
        type: 'asset',
        fileName: `${label}-bundle.txt`,
        source: `${this.environment.name}:${label}:generateBundle`,
      })
    },
    writeBundle() {
      writeLog('writeBundle', this.environment.name)
    },
  }
}

describe('src/multi-env', () => {
  it('simpleOptions composes a keyed object', () => {
    const composed = simpleOptions({
      main: {
        input: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
        options: {
          build: {
            minify: false,
          },
        },
      },
    })

    expect(composed[0]).toMatchObject({
      name: 'main',
      input: 'electron/main.ts',
      options: {
        build: {
          rolldownOptions: {
            platform: 'node',
          },
        },
      },
    })

    expect(composed[1]).toMatchObject({
      name: 'preload',
      input: 'electron/preload.ts',
      options: {
        build: {
          minify: false,
          rolldownOptions: {
            platform: 'node',
            output: {
              format: 'cjs',
              codeSplitting: false,
              entryFileNames: '[name].mjs',
              chunkFileNames: '[name].mjs',
              assetFileNames: '[name].[ext]',
            },
          },
        },
      },
    })

    expect(composed[0].onstart).toBeUndefined()

    const reload = vi.fn()
    composed[1].onstart?.({
      reload,
      startup: async () => {},
    } as never)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('simpleOptions does not share state between calls', () => {
    const first = simpleOptions({
      main: { input: 'electron/main.ts' },
      preload: { input: 'electron/preload.ts' },
    })

    const firstMainBuild = (first[0].options as { build: Record<string, unknown> }).build
    firstMainBuild.minify = 'first-mutated'
    ;(firstMainBuild.rolldownOptions as Record<string, unknown>).platform = 'mutated'

    const firstPreloadOutput = (
      first[1].options as { build: { rolldownOptions: { output: Record<string, unknown> } } }
    ).build.rolldownOptions.output
    firstPreloadOutput.entryFileNames = 'mutated.[name].mjs'

    const second = simpleOptions({
      main: { input: 'electron/main.ts' },
      preload: { input: 'electron/preload.ts' },
    })

    expect(second[0]).toMatchObject({
      name: 'main',
      options: {
        build: {
          rolldownOptions: {
            platform: 'node',
          },
        },
      },
    })
    expect((second[0].options as { build: Record<string, unknown> }).build.minify).toBeUndefined()

    expect(second[1]).toMatchObject({
      name: 'preload',
      options: {
        build: {
          rolldownOptions: {
            platform: 'node',
            output: {
              entryFileNames: '[name].mjs',
            },
          },
        },
      },
    })
  })

  it('mockHtml', async () => {
    trackDirs(mockHtmlOutDir)

    expect(fs.existsSync(mockHtmlPath)).toBe(false)

    const builder = await createBuilder({
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
    await builder.buildApp()

    expect(fs.existsSync(mockHtmlPath)).toBe(false)
    expect(fs.existsSync(mockHtmlDistPath)).toBe(false)
  })

  it('builds electron flat environments without rebuilding the renderer app', async () => {
    const root = path.join(__dirname, 'fixtures/flat-build')
    const appOutDir = path.join(__dirname, 'dist-flat-build-app')
    const electronOutDir = path.join(__dirname, 'dist-flat-build-electron')
    const buildLogPath = path.join(electronOutDir, 'build-log.txt')

    const rendererVirtualPlugin: Plugin = {
      name: 'flat-build-renderer-virtual',
      resolveId(id) {
        if (id === 'virtual:flat-build/renderer-status') {
          return '\0virtual:flat-build/renderer-status'
        }
      },
      load(id) {
        if (id === '\0virtual:flat-build/renderer-status') {
          return 'export const rendererLoadedStatus = "renderer-loaded"'
        }
      },
    }

    const mainVirtualPlugin: Plugin = {
      name: 'flat-build-main-virtual',
      resolveId(id) {
        if (id === 'virtual:flat-build/main-status') {
          return '\0virtual:flat-build/main-status'
        }
      },
      load(id) {
        if (id === '\0virtual:flat-build/main-status') {
          return 'export const mainLoadedStatus = "main-loaded"'
        }
      },
      closeBundle() {
        fs.appendFileSync(buildLogPath, `${this.environment.name}\n`, 'utf-8')
      },
    }

    await resetDirs(appOutDir, electronOutDir)

    const builder = await createBuilder({
      configFile: false,
      root,
      build: {
        outDir: appOutDir,
        emptyOutDir: true,
        minify: false,
      },
      plugins: [
        rendererVirtualPlugin,
        electron([
          {
            input: 'electron/main.ts',
            plugins: [mainVirtualPlugin],
            options: {
              build: {
                outDir: electronOutDir,
                minify: false,
              },
            },
          },
        ]),
      ],
      logLevel: 'silent',
    })
    await builder.buildApp()

    expect(fs.existsSync(path.join(appOutDir, 'index.html'))).toBe(false)
    expect(fs.existsSync(path.join(electronOutDir, 'main.js'))).toBe(true)

    const mainCode = fs
      .readFileSync(path.join(electronOutDir, 'main.js'), 'utf-8')
      .replace(normalizingNewLineRE, '\n')
    const buildLog = fs.readFileSync(buildLogPath, 'utf-8').trim().split(/\r?\n/)

    expect(mainCode).toContain('main-loaded')
    expect(buildLog).toEqual(['electron_0'])
  })

  it('merges per-environment define options before Electron builds', async () => {
    const root = path.join(__dirname, 'fixtures')
    const appOutDir = path.join(__dirname, 'dist-env-hooks-app')
    const electronOutDir = path.join(__dirname, 'dist-env-hooks-electron')

    await resetDirs(appOutDir, electronOutDir)

    const builder = await createBuilder({
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
          input: 'env-status.ts',
          options: {
            define: {
              __ENV_CONFIG_STATUS__: JSON.stringify('config-main'),
              __ENV_ENV_STATUS__: JSON.stringify('env-main'),
            },
            build: {
              minify: false,
              outDir: electronOutDir,
            },
          },
        },
      ]),
      logLevel: 'silent',
    })
    await builder.buildApp()

    const mainCode = fs
      .readFileSync(path.join(electronOutDir, 'env-status.js'), 'utf-8')
      .replace(normalizingNewLineRE, '\n')

    expect(mainCode).toContain('"config-main"')
    expect(mainCode).toContain('"env-main"')
  })

  it('merges per-environment build options beyond shortcut fields', async () => {
    const root = path.join(__dirname, 'fixtures')
    const appOutDir = path.join(__dirname, 'dist-env-hook-merge-app')
    const electronOutDir = path.join(__dirname, 'dist-env-hook-merge-electron')

    await resetDirs(appOutDir, electronOutDir)

    const builder = await createBuilder({
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
          input: 'env-main.ts',
          options: {
            define: {
              __ENV_NAME__: JSON.stringify('config-merged'),
            },
            build: {
              minify: false,
              outDir: electronOutDir,
              rolldownOptions: {
                output: {
                  banner: '/* config-merged-banner */',
                },
              },
            },
          },
        },
      ]),
      logLevel: 'silent',
    })
    await builder.buildApp()

    const mainCode = fs
      .readFileSync(path.join(electronOutDir, 'env-main.js'), 'utf-8')
      .replace(normalizingNewLineRE, '\n')

    expect(mainCode).toContain('"config-merged"')
    expect(mainCode).toContain('config-merged-banner')
  })

  it('isolates per-option config overrides in the option array', async () => {
    const root = path.join(__dirname, 'fixtures')
    const appOutDir = path.join(__dirname, 'dist-config-overrides-app')
    const mainOutDir = path.join(__dirname, 'dist-config-overrides-main')
    const preloadOutDir = path.join(__dirname, 'dist-config-overrides-preload')

    await resetDirs(appOutDir, mainOutDir, preloadOutDir)

    const builder = await createBuilder({
      configFile: false,
      root,
      build: {
        outDir: appOutDir,
        emptyOutDir: true,
        minify: false,
      },
      define: {
        __ENV_NAME__: JSON.stringify('app-default'),
      },
      plugins: electron([
        {
          name: 'main',
          input: 'env-main.ts',
          options: {
            define: {
              __ENV_NAME__: JSON.stringify('main-override'),
            },
            build: {
              minify: false,
              outDir: mainOutDir,
            },
          },
        },
        {
          name: 'preload',
          input: 'env-preload.ts',
          options: {
            define: {
              __ENV_NAME__: JSON.stringify('preload-override'),
            },
            build: {
              minify: false,
              outDir: preloadOutDir,
            },
          },
        },
      ]),
      logLevel: 'silent',
    })
    await builder.buildApp()

    const mainCode = fs
      .readFileSync(path.join(mainOutDir, 'env-main.js'), 'utf-8')
      .replace(normalizingNewLineRE, '\n')
    const preloadCode = fs
      .readFileSync(path.join(preloadOutDir, 'env-preload.js'), 'utf-8')
      .replace(normalizingNewLineRE, '\n')

    expect(mainCode).toContain('"main-override"')
    expect(mainCode).not.toContain('"preload-override"')
    expect(mainCode).not.toContain('"app-default"')

    expect(preloadCode).toContain('"preload-override"')
    expect(preloadCode).not.toContain('"main-override"')
    expect(preloadCode).not.toContain('"app-default"')
  })

  it('isolates per-option plugin overrides in the option array', async () => {
    const root = path.join(__dirname, 'fixtures')
    const appOutDir = path.join(__dirname, 'dist-plugin-overrides-app')
    const mainOutDir = path.join(__dirname, 'dist-plugin-overrides-main')
    const preloadOutDir = path.join(__dirname, 'dist-plugin-overrides-preload')

    const mainPlugin: Plugin = {
      name: 'main-override-plugin',
      renderChunk(code) {
        return `/* ${this.environment.name}:main-only */\n${code}`
      },
    }

    const preloadPlugin: Plugin = {
      name: 'preload-override-plugin',
      renderChunk(code) {
        return `/* ${this.environment.name}:preload-only */\n${code}`
      },
    }

    await resetDirs(appOutDir, mainOutDir, preloadOutDir)

    const builder = await createBuilder({
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
          input: 'env-main.ts',
          plugins: [mainPlugin],
          options: {
            build: {
              minify: false,
              outDir: mainOutDir,
            },
          },
        },
        {
          name: 'preload',
          input: 'env-preload.ts',
          plugins: [preloadPlugin],
          options: {
            build: {
              minify: false,
              outDir: preloadOutDir,
            },
          },
        },
      ]),
      logLevel: 'silent',
    })
    await builder.buildApp()

    const mainCode = fs
      .readFileSync(path.join(mainOutDir, 'env-main.js'), 'utf-8')
      .replace(normalizingNewLineRE, '\n')
    const preloadCode = fs
      .readFileSync(path.join(preloadOutDir, 'env-preload.js'), 'utf-8')
      .replace(normalizingNewLineRE, '\n')

    expect(mainCode).toContain('electron_main:main-only')
    expect(mainCode).not.toContain('preload-only')

    expect(preloadCode).toContain('electron_preload:preload-only')
    expect(preloadCode).not.toContain('main-only')
  })

  it('runs build lifecycle hooks per environment without cross-applying plugins', async () => {
    const root = path.join(__dirname, 'fixtures')
    const appOutDir = path.join(__dirname, 'dist-lifecycle-hooks-app')
    const mainOutDir = path.join(__dirname, 'dist-lifecycle-hooks-main')
    const preloadOutDir = path.join(__dirname, 'dist-lifecycle-hooks-preload')
    const logsDir = path.join(__dirname, 'dist-lifecycle-hooks-logs')
    const mainLogPath = path.join(logsDir, 'main.log')
    const preloadLogPath = path.join(logsDir, 'preload.log')

    await resetDirs(appOutDir, mainOutDir, preloadOutDir, logsDir)

    const builder = await createBuilder({
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
          input: 'env-main.ts',
          plugins: [createLifecyclePlugin('main', mainLogPath)],
          options: {
            build: {
              minify: false,
              outDir: mainOutDir,
            },
          },
        },
        {
          name: 'preload',
          input: 'env-preload.ts',
          plugins: [createLifecyclePlugin('preload', preloadLogPath)],
          options: {
            build: {
              minify: false,
              outDir: preloadOutDir,
            },
          },
        },
      ]),
      logLevel: 'silent',
    })
    await builder.buildApp()

    const mainCode = fs
      .readFileSync(path.join(mainOutDir, 'env-main.js'), 'utf-8')
      .replace(normalizingNewLineRE, '\n')
    const preloadCode = fs
      .readFileSync(path.join(preloadOutDir, 'env-preload.js'), 'utf-8')
      .replace(normalizingNewLineRE, '\n')
    const mainLog = fs.readFileSync(mainLogPath, 'utf-8').trim().split(/\r?\n/)
    const preloadLog = fs.readFileSync(preloadLogPath, 'utf-8').trim().split(/\r?\n/)

    expect(mainCode).toContain('electron_main:main:transform')
    expect(mainCode).not.toContain('preload:transform')
    expect(preloadCode).toContain('electron_preload:preload:transform')
    expect(preloadCode).not.toContain('main:transform')

    expect(fs.readFileSync(path.join(mainOutDir, 'main-bundle.txt'), 'utf-8')).toBe(
      'electron_main:main:generateBundle',
    )
    expect(fs.readFileSync(path.join(preloadOutDir, 'preload-bundle.txt'), 'utf-8')).toBe(
      'electron_preload:preload:generateBundle',
    )

    expect(mainLog).toEqual([
      'electron_main:main:buildStart',
      'electron_main:main:transform',
      'electron_main:main:buildEnd',
      'electron_main:main:generateBundle',
      'electron_main:main:writeBundle',
    ])
    expect(preloadLog).toEqual([
      'electron_preload:preload:buildStart',
      'electron_preload:preload:transform',
      'electron_preload:preload:buildEnd',
      'electron_preload:preload:generateBundle',
      'electron_preload:preload:writeBundle',
    ])
  })

  it('electron flat api uses named environments', async () => {
    const root = path.join(__dirname, 'fixtures')
    const appOutDir = path.join(__dirname, 'dist-electron-flat-app')
    const electronOutDir = path.join(__dirname, 'dist-electron-flat')

    await resetDirs(appOutDir, electronOutDir)

    const builder = await createBuilder({
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
          input: 'env-main.ts',
          plugins: [
            {
              name: 'flat-main-plugin',
              renderChunk(code) {
                return `/* ${this.environment.name}:flat-main */\n${code}`
              },
            },
          ],
          options: {
            define: {
              __ENV_NAME__: JSON.stringify('flat-main'),
            },
            build: {
              minify: false,
              outDir: electronOutDir,
            },
          },
        },
        {
          name: 'preload',
          input: 'env-preload.ts',
          plugins: [
            {
              name: 'flat-preload-plugin',
              renderChunk(code) {
                return `/* ${this.environment.name}:flat-preload */\n${code}`
              },
            },
          ],
          options: {
            define: {
              __ENV_NAME__: JSON.stringify('flat-preload'),
            },
            build: {
              minify: false,
              outDir: electronOutDir,
            },
          },
        },
      ]),
      logLevel: 'silent',
    })
    await builder.buildApp()

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
  })

  it('respects user-defined buildApp and still builds electron environments', async () => {
    const root = path.join(__dirname, 'fixtures')
    const appOutDir = path.join(__dirname, 'dist-user-buildapp-app')
    const electronOutDir = path.join(__dirname, 'dist-user-buildapp-electron')

    await resetDirs(appOutDir, electronOutDir)

    // Track which environments the user's buildApp was invoked for
    const userBuiltEnvs: string[] = []

    const builder = await createBuilder({
      configFile: false,
      root,
      build: {
        outDir: appOutDir,
        emptyOutDir: true,
        minify: false,
      },
      builder: {
        async buildApp(b) {
          for (const [name, env] of Object.entries(b.environments)) {
            userBuiltEnvs.push(name)
            await b.build(env)
          }
        },
      },
      plugins: electron([
        {
          name: 'main',
          input: 'env-main.ts',
          options: {
            define: {
              __ENV_NAME__: JSON.stringify('user-buildapp-main'),
            },
            build: {
              minify: false,
              outDir: electronOutDir,
            },
          },
        },
      ]),
      logLevel: 'silent',
    })
    await builder.buildApp()

    // The user's buildApp should have been called.
    expect(userBuiltEnvs.length).toBeGreaterThan(0)

    // The electron environment should have been built regardless of whether
    // the user's buildApp included it.
    const mainCode = fs
      .readFileSync(path.join(electronOutDir, 'env-main.js'), 'utf-8')
      .replace(normalizingNewLineRE, '\n')
    expect(mainCode).toContain('"user-buildapp-main"')
  })
})
