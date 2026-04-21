import fs from 'node:fs'
import path from 'node:path'

import { createBuilder } from 'vite'
import type { ConfigEnv, Plugin, UserConfig } from 'vite'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import electron from '../src/index'
import type { ElectronOptions } from '../src/index'

const buildEnv: ConfigEnv = { command: 'build', mode: 'production', isPreview: false }
const normalizingNewLineRE = /[\r\n]+/g
const generatedDirs = [
  'dist-renderer-override',
  'dist-electron-override-a',
  'dist-electron-override-b',
]

function getElectronPlugins(options: ElectronOptions | ElectronOptions[]) {
  return electron(options) as Plugin[]
}

function readNormalizedFile(filePath: string) {
  return fs.readFileSync(filePath, 'utf-8').replace(normalizingNewLineRE, '\n')
}

function cleanupGeneratedDirs() {
  for (const dirName of generatedDirs) {
    fs.rmSync(path.join(__dirname, dirName), { recursive: true, force: true })
  }
}

beforeAll(cleanupGeneratedDirs)
afterEach(cleanupGeneratedDirs)

/**
 * Call the `vite-plugin-electron:prod` config hook directly and return the
 * resulting config so we can inspect `createBuildConfig` output without
 * running a real Vite build.
 */
function applyBuildConfig(
  options: ElectronOptions | ElectronOptions[],
  userConfig: UserConfig = {},
  env: ConfigEnv = buildEnv,
): UserConfig | null | undefined {
  const plugins = getElectronPlugins(options)
  const prodPlugin = plugins.find((p) => p.name === 'vite-plugin-electron:prod')!
  const configFn = prodPlugin.config as (
    config: UserConfig,
    env: ConfigEnv,
  ) => UserConfig | null | undefined
  return configFn({ base: './', ...userConfig }, env)
}

describe('electron() plugin array', () => {
  it('includes the dev, prod, and any per-environment plugins', () => {
    const plugins = getElectronPlugins([{ entry: 'main.ts' }])
    const names = plugins.map((p) => p.name)
    expect(names).toContain('vite-plugin-electron:dev')
    expect(names).toContain('vite-plugin-electron:prod')
  })

  it('accepts a single options object (non-array)', () => {
    const plugins = getElectronPlugins({ entry: 'main.ts' })
    expect(plugins.find((p) => p.name === 'vite-plugin-electron:prod')).toBeDefined()
  })
})

describe('createBuildConfig / resolveSharedConfig', () => {
  it('returns undefined for an empty options array', () => {
    expect(applyBuildConfig([])).toBeUndefined()
  })

  it('inherits mode from ConfigEnv', () => {
    const result = applyBuildConfig([{ entry: 'main.ts' }], {}, { ...buildEnv, mode: 'staging' })
    expect(result?.mode).toBe('staging')
  })

  it('inherits root from user config', () => {
    const result = applyBuildConfig([{ entry: 'main.ts' }], { root: '/custom/root' })
    expect(result?.root).toBe('/custom/root')
  })

  it('inherits envPrefix from user config', () => {
    const result = applyBuildConfig([{ entry: 'main.ts' }], { envPrefix: 'APP_' })
    expect(result?.envPrefix).toBe('APP_')
  })

  it('inherits envPrefix array from user config', () => {
    const result = applyBuildConfig([{ entry: 'main.ts' }], { envPrefix: ['APP_', 'VITE_'] })
    expect(result?.envPrefix).toEqual(['APP_', 'VITE_'])
  })

  it('includes envDir when user config envDir is a string', () => {
    const result = applyBuildConfig([{ entry: 'main.ts' }], { envDir: '/custom/env' })
    expect(result?.envDir).toBe('/custom/env')
  })

  it('omits envDir when user config has no envDir', () => {
    const result = applyBuildConfig([{ entry: 'main.ts' }])
    expect(result?.envDir).toBeUndefined()
  })

  it('creates one environment per option, keyed by electron_N', () => {
    const result = applyBuildConfig([{ entry: 'main.ts' }, { entry: 'preload.ts' }])
    expect(Object.keys(result?.environments ?? {})).toEqual(['electron_0', 'electron_1'])
  })

  it('sets consumer to server for every environment', () => {
    const result = applyBuildConfig([{ entry: 'main.ts' }, { entry: 'preload.ts' }])
    expect((result?.environments?.electron_0 as any)?.consumer).toBe('server')
    expect((result?.environments?.electron_1 as any)?.consumer).toBe('server')
  })
})

describe('createEnvironmentOptionsMap — per-environment config overrides', () => {
  it('reflects entry in build.lib.entry for each environment', () => {
    const result = applyBuildConfig([{ entry: 'src/main.ts' }, { entry: 'src/preload.ts' }])
    expect((result?.environments?.electron_0 as any)?.build?.lib?.entry).toBe('src/main.ts')
    expect((result?.environments?.electron_1 as any)?.build?.lib?.entry).toBe('src/preload.ts')
  })

  it('defaults build.outDir to dist-electron', () => {
    const result = applyBuildConfig([{ entry: 'main.ts' }])
    expect((result?.environments?.electron_0 as any)?.build?.outDir).toBe('dist-electron')
  })

  it('allows overriding build.outDir via vite.build', () => {
    const result = applyBuildConfig([{ entry: 'main.ts', vite: { build: { outDir: 'my-dist' } } }])
    expect((result?.environments?.electron_0 as any)?.build?.outDir).toBe('my-dist')
  })

  it('each environment has its own independent build.outDir', () => {
    const result = applyBuildConfig([
      { entry: 'main.ts', vite: { build: { outDir: 'dist-main' } } },
      { entry: 'preload.ts', vite: { build: { outDir: 'dist-preload' } } },
    ])
    expect((result?.environments?.electron_0 as any)?.build?.outDir).toBe('dist-main')
    expect((result?.environments?.electron_1 as any)?.build?.outDir).toBe('dist-preload')
  })

  it('merges vite.define with the default define', () => {
    const result = applyBuildConfig([{ entry: 'main.ts', vite: { define: { MY_VAR: '"hello"' } } }])
    const env0 = result?.environments?.electron_0 as any
    expect(env0?.define?.['process.env']).toBe('process.env') // default
    expect(env0?.define?.MY_VAR).toBe('"hello"') // override
  })

  it('merges vite.resolve with the default resolve config', () => {
    const result = applyBuildConfig([
      { entry: 'main.ts', vite: { resolve: { conditions: ['custom'] } } },
    ])
    const conditions = (result?.environments?.electron_0 as any)?.resolve?.conditions as string[]
    expect(conditions).toContain('node') // default
    expect(conditions).toContain('custom') // override
  })

  it('sets optimizeDeps when provided via vite.optimizeDeps', () => {
    const result = applyBuildConfig([
      { entry: 'main.ts', vite: { optimizeDeps: { exclude: ['heavy-dep'] } } },
    ])
    expect((result?.environments?.electron_0 as any)?.optimizeDeps?.exclude).toContain('heavy-dep')
  })

  it('per-option root override does not affect the shared root', () => {
    const result = applyBuildConfig([{ entry: 'main.ts', vite: { root: '/opt-root' } }], {
      root: '/default-root',
    })
    // resolveSharedConfig uses defaults.root (from user config), not option-level root
    expect(result?.root).toBe('/default-root')
  })
})

describe('createPerEnvironmentPlugins — vite plugin overrides', () => {
  it('applies vite plugin overrides during a real electron build', async () => {
    const root = path.join(__dirname, 'fixtures/mock-html')
    const fixtureEntry = path.resolve(__dirname, 'fixtures/electron-main.ts')

    const makeOverridePlugin = (replacement: string): Plugin => ({
      name: `override-${replacement}`,
      renderChunk(code) {
        return code.includes('path.join("app", "resources")')
          ? code.replace(
              'path.join("app", "resources")',
              `path.join("${replacement}", "resources")`,
            )
          : undefined
      },
    })

    const electronOutDirA = path.join(__dirname, 'dist-electron-override-a')
    const electronOutDirB = path.join(__dirname, 'dist-electron-override-b')

    const builder = await createBuilder({
      configFile: false,
      root,
      build: {
        outDir: path.join(__dirname, 'dist-renderer-override'),
        emptyOutDir: true,
        minify: false,
      },
      plugins: electron([
        {
          entry: fixtureEntry,
          vite: {
            build: { outDir: electronOutDirA, emptyOutDir: true, minify: false },
            plugins: [makeOverridePlugin('main')],
          },
        },
        {
          entry: fixtureEntry,
          vite: {
            build: { outDir: electronOutDirB, emptyOutDir: true, minify: false },
            plugins: [makeOverridePlugin('preload')],
          },
        },
      ]),
      logLevel: 'silent',
    })

    await builder.buildApp()

    expect({
      electron_0: readNormalizedFile(path.join(electronOutDirA, 'electron-main.js')),
      electron_1: readNormalizedFile(path.join(electronOutDirB, 'electron-main.js')),
    }).toMatchSnapshot()
  })
})
