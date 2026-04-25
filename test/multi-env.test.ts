import fs from 'node:fs'
import path from 'node:path'

import { build } from 'vite'
import type { Plugin } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'

import electron from '../src/multi-env'

const normalizingNewLineRE = /[\r\n]+/g

const cleanupDirs = new Set<string>()

afterEach(async () => {
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
  it('mockHtml', async () => {
    const root = path.join(__dirname, 'fixtures/mock-html')
    const outDir = path.join(__dirname, 'dist-mock-html')
    const htmlPath = path.join(root, 'index.html')
    const distHtmlPath = path.join(outDir, 'index.html')

    trackDirs(outDir)

    expect(fs.existsSync(htmlPath)).toBe(false)

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

    expect(fs.existsSync(htmlPath)).toBe(false)
    expect(fs.existsSync(distHtmlPath)).toBe(false)
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

    // The .foo import only works if config() merges assetsInclude early enough
    // for Vite's asset pipeline to see it.
    await build({
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
            entry: 'electron/main.ts',
            vite: {
              build: {
                outDir: electronOutDir,
                minify: false,
              },
              plugins: [mainVirtualPlugin],
            },
          },
        ]),
      ],
      logLevel: 'silent',
    })

    expect(fs.existsSync(path.join(appOutDir, 'index.html'))).toBe(true)
    expect(fs.existsSync(path.join(electronOutDir, 'main.js'))).toBe(true)

    const mainCode = fs
      .readFileSync(path.join(electronOutDir, 'main.js'), 'utf-8')
      .replace(normalizingNewLineRE, '\n')
    const buildLog = fs.readFileSync(buildLogPath, 'utf-8').trim().split(/\r?\n/)

    expect(mainCode).toContain('main-loaded')
    expect(buildLog).toEqual(['electron_0'])
  })

  it('proxies config hooks for env-scoped plugins before Electron builds', async () => {
    const root = path.join(__dirname, 'fixtures')
    const appOutDir = path.join(__dirname, 'dist-env-hooks-app')
    const electronOutDir = path.join(__dirname, 'dist-env-hooks-electron')

    const statusPlugin: Plugin = {
      name: 'flat-build-status-plugin',
      config() {
        return {
          define: {
            __ENV_CONFIG_STATUS__: JSON.stringify('config-main'),
          },
        }
      },
      configEnvironment(environmentName) {
        if (environmentName !== 'electron_main') {
          return
        }

        return {
          define: {
            __ENV_ENV_STATUS__: JSON.stringify('env-main'),
          },
        }
      },
    }

    await resetDirs(appOutDir, electronOutDir)

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
          entry: 'env-status.ts',
          vite: {
            build: {
              minify: false,
              outDir: electronOutDir,
            },
            plugins: [statusPlugin],
          },
        },
      ]),
      logLevel: 'silent',
    })

    const mainCode = fs
      .readFileSync(path.join(electronOutDir, 'env-status.js'), 'utf-8')
      .replace(normalizingNewLineRE, '\n')

    expect(mainCode).toContain('"config-main"')
    expect(mainCode).toContain('"env-main"')
  })

  it('merges config hook results beyond EnvironmentOptions fields', async () => {
    const root = path.join(__dirname, 'fixtures')
    const appOutDir = path.join(__dirname, 'dist-env-hook-merge-app')
    const electronOutDir = path.join(__dirname, 'dist-env-hook-merge-electron')

    const mergePlugin: Plugin = {
      name: 'merge-config-plugin',
      config() {
        return {
          define: {
            __ENV_NAME__: JSON.stringify('config-merged'),
          },
          assetsInclude: ['**/*.foo'],
        }
      },
    }

    await resetDirs(appOutDir, electronOutDir)

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
          entry: 'env-config-merge.ts',
          vite: {
            build: {
              assetsInlineLimit: 0,
              minify: false,
              outDir: electronOutDir,
            },
            plugins: [mergePlugin],
          },
        },
      ]),
      logLevel: 'silent',
    })

    const mainCode = fs
      .readFileSync(path.join(electronOutDir, 'env-config-merge.js'), 'utf-8')
      .replace(normalizingNewLineRE, '\n')

    expect(mainCode).toContain('"config-merged"')
  })

  it('isolates per-option config overrides in the option array', async () => {
    const root = path.join(__dirname, 'fixtures')
    const appOutDir = path.join(__dirname, 'dist-config-overrides-app')
    const mainOutDir = path.join(__dirname, 'dist-config-overrides-main')
    const preloadOutDir = path.join(__dirname, 'dist-config-overrides-preload')

    await resetDirs(appOutDir, mainOutDir, preloadOutDir)

    await build({
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
          entry: 'env-main.ts',
          vite: {
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
          entry: 'env-preload.ts',
          vite: {
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
            build: {
              minify: false,
              outDir: mainOutDir,
            },
            plugins: [mainPlugin],
          },
        },
        {
          name: 'preload',
          entry: 'env-preload.ts',
          vite: {
            build: {
              minify: false,
              outDir: preloadOutDir,
            },
            plugins: [preloadPlugin],
          },
        },
      ]),
      logLevel: 'silent',
    })

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
            build: {
              minify: false,
              outDir: mainOutDir,
            },
            plugins: [createLifecyclePlugin('main', mainLogPath)],
          },
        },
        {
          name: 'preload',
          entry: 'env-preload.ts',
          vite: {
            build: {
              minify: false,
              outDir: preloadOutDir,
            },
            plugins: [createLifecyclePlugin('preload', preloadLogPath)],
          },
        },
      ]),
      logLevel: 'silent',
    })

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
  })
})
