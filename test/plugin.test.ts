import fs from 'node:fs'
import path from 'node:path'

import { build } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import electron from '../src'
import { createElectronPlugin } from '../src/base'
import { notBundle } from '../src/plugin'
import { compatRollupOptions, resolveInput, withExternalBuiltins } from '../src/utils'

const pluginNotBundle = notBundle()
pluginNotBundle.apply = undefined
const mockHtmlRoot = path.join(__dirname, 'fixtures/mock-html-plugin')
const mockHtmlPath = path.join(mockHtmlRoot, 'index.html')
const mockHtmlOutDir = path.join(__dirname, 'dist-mock-html-plugin')
const mockHtmlDistPath = path.join(mockHtmlOutDir, 'index.html')
const originalViteIsDev = process.env.VITE_IS_DEV

async function cleanupMockHtml() {
  await Promise.all([
    fs.promises.rm(mockHtmlPath, { force: true }),
    fs.promises.rm(mockHtmlOutDir, { recursive: true, force: true }),
  ])
}

beforeEach(async () => {
  await cleanupMockHtml()
  fs.mkdirSync(mockHtmlRoot, { recursive: true })
  if (originalViteIsDev === undefined) {
    delete process.env.VITE_IS_DEV
  } else {
    process.env.VITE_IS_DEV = originalViteIsDev
  }
})

afterEach(async () => {
  await cleanupMockHtml()
  if (originalViteIsDev === undefined) {
    delete process.env.VITE_IS_DEV
  } else {
    process.env.VITE_IS_DEV = originalViteIsDev
  }
})

describe('src/plugin', () => {
  it('compatRollupOptions keeps only the active build key', () => {
    const build = compatRollupOptions({
      rolldownOptions: {
        external: ['vite'],
      },
    }) as {
      rolldownOptions?: { external?: string[] }
      rollupOptions?: { external?: string[] }
    }

    expect(build.rolldownOptions?.external).toEqual(['vite'])
    expect(build.rollupOptions).toBeUndefined()
  })

  it('compatRollupOptions keeps only rollupOptions on Vite 7', async () => {
    const build = compatRollupOptions(
      {
        rolldownOptions: {
          external: ['vite'],
        },
      },
      '7.2.7',
    ) as {
      rolldownOptions?: { external?: string[] }
      rollupOptions?: { external?: string[] }
    }

    expect(build.rollupOptions?.external).toEqual(['vite'])
    expect(build.rolldownOptions).toBeUndefined()
  })

  it('notBundle uses the wider default external set during development', () => {
    process.env.VITE_IS_DEV = 'true'

    const config = (pluginNotBundle.config as any)?.(
      { root: __dirname } as never,
      { command: 'serve', mode: 'development' } as never,
    ) as { build?: { rolldownOptions?: { external?: unknown[] } } }

    expect(config?.build?.rolldownOptions?.external).toEqual(
      expect.arrayContaining(['local-pkg', '@types/node', 'vite-plugin-electron-renderer', 'vite']),
    )
  })

  it('notBundle uses the narrower default external set during production', () => {
    delete process.env.VITE_IS_DEV

    const config = (pluginNotBundle.config as any)?.(
      { root: __dirname } as never,
      { command: 'build', mode: 'production' } as never,
    ) as { build?: { rolldownOptions?: { external?: string[] } } }

    expect(config?.build?.rolldownOptions?.external).toEqual(expect.arrayContaining(['local-pkg']))
    expect(config?.build?.rolldownOptions?.external).not.toEqual(
      expect.arrayContaining(['@types/node', 'vite-plugin-electron-renderer', 'vite']),
    )
  })

  it('withExternalBuiltins keeps node protocol imports external with function external', () => {
    const config = withExternalBuiltins({
      build: {
        rolldownOptions: {
          external: () => false,
        },
      },
    }) as { build?: { rolldownOptions?: { external?: (pkg: string) => boolean } } }

    const external = config.build?.rolldownOptions?.external

    expect(external?.('fs')).toBe(true)
    expect(external?.('node:fs')).toBe(true)
    expect(external?.('left-pad')).toBe(false)
  })

  it('withExternalBuiltins writes external options when build options are empty', () => {
    const config = withExternalBuiltins({
      build: {},
      environments: {
        electron: {
          build: {},
        },
      },
    }) as {
      build?: { rolldownOptions?: { external?: unknown[] } }
      environments?: Record<string, { build?: { rolldownOptions?: { external?: unknown[] } } }>
    }

    expect(config.build?.rolldownOptions?.external).toEqual(expect.arrayContaining(['electron']))
    expect(config.environments?.electron.build?.rolldownOptions?.external).toEqual(
      expect.arrayContaining(['electron']),
    )
  })

  it('awaits async buildConfig results in production mode', async () => {
    const buildConfig = vi.fn(async () => ({
      define: {
        __ASYNC_BUILD_CONFIG__: JSON.stringify('resolved'),
      },
    }))

    const plugins = createElectronPlugin({
      prefix: 'vite-plugin-electron-test',
      dev: vi.fn(),
      build: vi.fn(),
      buildConfig,
    })

    const config = await (plugins[1].config as any)?.(
      { root: __dirname } as never,
      { command: 'build', mode: 'production' } as never,
    )

    expect(buildConfig).toHaveBeenCalledWith(
      expect.objectContaining({ root: __dirname }),
      expect.objectContaining({ command: 'build', mode: 'production' }),
    )
    expect(config).toMatchObject({
      base: './',
      define: {
        __ASYNC_BUILD_CONFIG__: '"resolved"',
      },
    })
  })

  it('resolveInput reads rollupOptions.input', () => {
    const input = resolveInput({
      root: __dirname,
      build: {
        rollupOptions: {
          input: 'fixtures/external-main.ts',
        },
      },
    } as never)

    expect(input).toBe(path.resolve(__dirname, 'fixtures/external-main.ts'))
  })

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
