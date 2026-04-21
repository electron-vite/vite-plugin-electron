import type { ConfigEnv, Plugin, UserConfig } from 'vite'
import { describe, expect, it } from 'vitest'

import electron from '../src/index'
import type { ElectronOptions } from '../src/index'

const buildEnv: ConfigEnv = { command: 'build', mode: 'production', isPreview: false }

function getElectronPlugins(options: ElectronOptions | ElectronOptions[]) {
  return electron(options) as Plugin[]
}

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
  const configFn = prodPlugin.config as (config: UserConfig, env: ConfigEnv) => UserConfig | null | undefined
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
    const result = applyBuildConfig([
      { entry: 'main.ts', vite: { define: { MY_VAR: '"hello"' } } },
    ])
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
    expect(
      (result?.environments?.electron_0 as any)?.optimizeDeps?.exclude,
    ).toContain('heavy-dep')
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
  it('wraps a single vite plugin as a per-environment plugin', () => {
    const testPlugin: Plugin = { name: 'test-plugin' }
    const plugins = getElectronPlugins([{ entry: 'main.ts', vite: { plugins: [testPlugin] } }])
    const wrapped = plugins.filter((p) => p.name?.match(/^electron_0:\d+$/))
    expect(wrapped).toHaveLength(1)
  })

  it('wraps each vite plugin with a separate per-environment entry', () => {
    const p1: Plugin = { name: 'plugin-a' }
    const p2: Plugin = { name: 'plugin-b' }
    const plugins = getElectronPlugins([{ entry: 'main.ts', vite: { plugins: [p1, p2] } }])
    const wrapped = plugins.filter((p) => p.name?.match(/^electron_0:\d+$/))
    expect(wrapped).toHaveLength(2)
  })

  it('wraps plugins independently for multiple options', () => {
    const p: Plugin = { name: 'shared-plugin' }
    const plugins = getElectronPlugins([
      { entry: 'main.ts', vite: { plugins: [p] } },
      { entry: 'preload.ts', vite: { plugins: [p] } },
    ])
    expect(plugins.filter((pl) => pl.name?.match(/^electron_0:\d+$/))).toHaveLength(1)
    expect(plugins.filter((pl) => pl.name?.match(/^electron_1:\d+$/))).toHaveLength(1)
  })

  it('produces no per-environment plugins when vite.plugins is not provided', () => {
    const plugins = getElectronPlugins([{ entry: 'main.ts' }])
    const perEnv = plugins.filter((p) => p.name?.match(/^electron_\d+:\d+$/))
    expect(perEnv).toHaveLength(0)
  })

  it('per-environment plugin is scoped to its own environment', async () => {
    const testPlugin: Plugin = { name: 'scoped-plugin' }
    const plugins = getElectronPlugins([{ entry: 'main.ts', vite: { plugins: [testPlugin] } }])
    const wrapped = plugins.find((p) => p.name?.match(/^electron_0:\d+$/)) as Plugin & {
      applyToEnvironment?: (env: { name: string }) => boolean | Plugin | null
    }
    expect(wrapped).toBeDefined()
    // The wrapper returns the inner plugin only for the correct environment
    expect(wrapped.applyToEnvironment?.({ name: 'electron_0' })).toBeTruthy()
    expect(wrapped.applyToEnvironment?.({ name: 'electron_1' })).toBeFalsy()
  })
})
