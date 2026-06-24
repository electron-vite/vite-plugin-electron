import { EventEmitter } from 'node:events'
import path from 'node:path'

import { createBuilder } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { electronSimple } from '../src/multi-env'

let capturedBuilderConfig: Record<string, any> | undefined

vi.mock('vite', async () => {
  const actual = await vi.importActual<typeof import('vite')>('vite')
  return {
    ...actual,
    createBuilder: vi.fn(async (config) => {
      capturedBuilderConfig = config as Record<string, any>
      return { environments: {} }
    }),
  }
})

afterEach(() => {
  capturedBuilderConfig = undefined
  delete process.env.VITE_DEV_SERVER_URL
})

describe('src/multi-env dev', () => {
  async function getDevEnvironmentConfig(plugins: ReturnType<typeof electronSimple>) {
    expect(vi.isMockFunction(createBuilder)).toBe(true)
    const devPlugin = plugins.find((plugin) => plugin.apply === 'serve')
    expect(devPlugin?.configureServer).toBeTypeOf('function')

    const httpServer = Object.assign(new EventEmitter(), {
      address() {
        return {
          address: '127.0.0.1',
          family: 'IPv4',
          port: 5173,
        }
      },
    })
    const server = {
      config: {
        root: path.resolve(__dirname, '..'),
        mode: 'development',
        envDir: path.resolve(__dirname, '..'),
        envPrefix: 'VITE_',
        base: '/',
        server: {},
      },
      httpServer,
    }

    // @ts-expect-error safe here
    devPlugin!.configureServer?.(server as never)
    // @ts-expect-error safe here
    const [onListening] = httpServer.rawListeners('listening') as Array<{
      listener: () => Promise<void>
    }>
    await onListening.listener()

    expect(capturedBuilderConfig).toBeDefined()
    return capturedBuilderConfig?.environments?.electron_main
  }

  async function getBuildEnvironmentConfig(plugins: ReturnType<typeof electronSimple>) {
    const buildPlugin = plugins.find((plugin) => plugin.apply === 'build')
    expect(buildPlugin?.config).toBeTypeOf('function')

    // @ts-expect-error object style hook
    const config = await buildPlugin!.config(
      { root: path.resolve(__dirname, '..') },
      { command: 'build', mode: 'production' },
    )

    return config?.environments?.electron_main
  }

  it('leaves dependency resolution to Vite when bundleDeps is omitted', async () => {
    const plugins = electronSimple({
      main: { input: 'fixtures/external-main.ts' },
    })

    const devConfig = await getDevEnvironmentConfig(plugins)
    const buildConfig = await getBuildEnvironmentConfig(plugins)

    expect(devConfig?.resolve?.external).toBeUndefined()
    expect(devConfig?.resolve?.noExternal).toBeUndefined()
    expect(buildConfig?.resolve?.external).toBeUndefined()
    expect(buildConfig?.resolve?.noExternal).toBeUndefined()
  })

  it('supports vite, auto, and boolean bundleDeps strategies', async () => {
    const vite = electronSimple({
      main: {
        input: 'fixtures/external-main.ts',
        bundleDeps: 'vite',
      },
    })
    const auto = electronSimple({
      main: {
        input: 'fixtures/external-main.ts',
        bundleDeps: 'auto',
      },
    })
    const bundleAll = electronSimple({
      main: {
        input: 'fixtures/external-main.ts',
        bundleDeps: true,
      },
    })
    const externalizeAll = electronSimple({
      main: {
        input: 'fixtures/external-main.ts',
        bundleDeps: false,
      },
    })

    const viteConfig = await getDevEnvironmentConfig(vite)
    const autoDevConfig = await getDevEnvironmentConfig(auto)
    const autoBuildConfig = await getBuildEnvironmentConfig(auto)
    const bundleAllConfig = await getDevEnvironmentConfig(bundleAll)
    const externalizeAllConfig = await getDevEnvironmentConfig(externalizeAll)

    expect(viteConfig?.resolve?.external).toBeUndefined()
    expect(viteConfig?.resolve?.noExternal).toBeUndefined()
    expect(autoDevConfig?.resolve?.external).toEqual(expect.arrayContaining(['local-pkg', 'vite']))
    expect(autoBuildConfig?.resolve?.external).toEqual(expect.arrayContaining(['local-pkg']))
    expect(autoBuildConfig?.resolve?.external).not.toEqual(expect.arrayContaining(['vite']))
    expect(bundleAllConfig?.resolve?.noExternal).toBe(true)
    expect(externalizeAllConfig?.resolve?.external).toBe(true)
  })

  it('applies bundleDeps only for the active mode', async () => {
    const plugins = electronSimple({
      main: {
        input: 'fixtures/external-main.ts',
        bundleDeps: {
          both: {
            exclude: ['local-pkg'],
            include: ['vite'],
          },
          build: {
            exclude: ['vite'],
            include: ['local-pkg'],
          },
        },
      },
    })

    const devConfig = await getDevEnvironmentConfig(plugins)
    const buildConfig = await getBuildEnvironmentConfig(plugins)

    expect(devConfig?.resolve).toMatchObject({
      external: ['local-pkg'],
      noExternal: ['vite'],
    })
    expect(buildConfig?.resolve).toMatchObject({
      external: ['local-pkg', 'vite'],
      noExternal: ['vite', 'local-pkg'],
    })
  })

  it('merges options.resolve with bundleDeps', async () => {
    const plugins = electronSimple({
      main: {
        input: 'fixtures/external-main.ts',
        bundleDeps: {
          dev: {
            exclude: ['local-pkg'],
            include: true,
          },
        },
        options: {
          resolve: {
            external: ['vite'],
            noExternal: ['local-pkg'],
          },
        },
      },
    })

    const envConfig = await getDevEnvironmentConfig(plugins)
    expect(envConfig?.resolve).toMatchObject({
      external: ['local-pkg', 'vite'],
      noExternal: true,
    })
  })
})
