import fs from 'node:fs'
import path from 'node:path'
import { build } from 'vite'
import {
  describe,
  expect,
  it,
} from 'vitest'
import { notBundle } from '../dist/plugin'

const pluginNotBundle = notBundle()
pluginNotBundle.apply = undefined

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

    const distMain = fs.readFileSync(path.join(__dirname, '__snapshots__/external-main.js'), 'utf-8')
    const snapMain = fs.readFileSync(path.join(__dirname, 'dist/external-main.js'), 'utf-8')

    expect(distMain).equal(snapMain)
  })
})
