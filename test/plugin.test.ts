import fs from 'node:fs'
import path from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vite-plus/test'
import { notBundle } from '../dist/plugin'

const pluginNotBundle = notBundle()
pluginNotBundle.apply = undefined
const normalizingNewLineRE = /\r\n/g

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

    const main = fs.readFileSync(
      path.join(__dirname, 'dist/external-main.js'),
      'utf-8',
    )
    const normalMain = main.replace(normalizingNewLineRE, '\n')

    // Keep assertions semantic because Rolldown/Oxc codegen is intentionally different from Rollup.
    expect(normalMain).toContain('require("vite")')
    expect(normalMain).toContain('console.log(import("vite"))')
    expect(normalMain).toContain('"foo"')
  })
})
