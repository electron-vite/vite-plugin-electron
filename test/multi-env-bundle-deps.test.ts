import fs from 'node:fs'
import path from 'node:path'

import { createBuilder } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'

import electron from '../src/multi-env'
import type { BundleDeps } from '../src/multi-env'

const root = path.join(__dirname, 'fixtures/bundle-deps')
const outputDirs = new Set<string>()

async function buildFixture(name: string, bundleDeps: BundleDeps): Promise<string> {
  const outDir = path.join(__dirname, `dist-bundle-deps-${name}`)
  const appOutDir = path.join(__dirname, `dist-bundle-deps-app-${name}`)
  outputDirs.add(outDir)
  outputDirs.add(appOutDir)
  await Promise.all(
    [outDir, appOutDir].map((dir) => fs.promises.rm(dir, { recursive: true, force: true })),
  )

  const builder = await createBuilder({
    configFile: false,
    root,
    build: {
      emptyOutDir: true,
      minify: false,
      outDir: appOutDir,
    },
    plugins: electron({
      name: 'main',
      input: 'main.ts',
      bundleDeps,
      options: {
        build: {
          minify: false,
          outDir,
        },
      },
    }),
    logLevel: 'silent',
  })
  await builder.buildApp()

  return fs.promises.readFile(path.join(outDir, 'main.js'), 'utf-8')
}

function hasExternalImport(code: string, id: string): boolean {
  return new RegExp(`(?:from|import\\()\\s*['"]${id.replace('/', '\\/')}['"]`).test(code)
}

afterEach(async () => {
  await Promise.all(
    [...outputDirs].map((dir) => fs.promises.rm(dir, { recursive: true, force: true })),
  )
  outputDirs.clear()
})

describe('src/multi-env bundleDeps', () => {
  it('changes real build output for each shortcut strategy', async () => {
    const [vite, auto, bundleAll, externalizeAll, bundleLocalPkg] = await Promise.all([
      buildFixture('vite', 'vite'),
      buildFixture('auto', 'auto'),
      buildFixture('bundle-all', true),
      buildFixture('externalize-all', false),
      buildFixture('bundle-local-pkg', {
        both: { include: ['local-pkg'] },
      }),
    ])

    expect(hasExternalImport(vite, 'local-pkg')).toBe(true)
    expect(hasExternalImport(vite, 'vite')).toBe(true)

    expect(hasExternalImport(auto, 'local-pkg')).toBe(true)
    expect(hasExternalImport(auto, 'vite')).toBe(false)

    expect(hasExternalImport(bundleAll, 'local-pkg')).toBe(false)
    expect(hasExternalImport(bundleAll, 'vite')).toBe(false)

    expect(hasExternalImport(externalizeAll, 'local-pkg')).toBe(true)
    expect(hasExternalImport(externalizeAll, 'vite')).toBe(true)

    expect(hasExternalImport(bundleLocalPkg, 'local-pkg')).toBe(false)
    expect(hasExternalImport(bundleLocalPkg, 'vite')).toBe(true)
  })
})
