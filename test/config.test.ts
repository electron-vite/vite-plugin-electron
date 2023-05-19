import { builtinModules } from 'node:module'
import { ExternalOption } from 'rollup'
import type { InlineConfig } from 'vite'
import {
  describe,
  expect,
  it,
} from 'vitest'
import { withExternalBuiltins } from '../src/config'

const builtins: any[] = builtinModules.filter(e => !e.startsWith('_')); builtins.push('electron', ...builtins.map(m => `node:${m}`))
const getConfig = (external: ExternalOption): InlineConfig => ({ build: { rollupOptions: { external } } })
const external_string: ExternalOption = 'electron'
const external_array: ExternalOption = ['electron']
const external_regexp: ExternalOption = /electron/
const external_function: ExternalOption = source => ['electron'].includes(source)

describe('src/config.ts', () => {
  it('withExternalBuiltins', async () => {
    const external_str = withExternalBuiltins(getConfig(external_string))!.build!.rollupOptions!.external
    expect(external_str).toEqual(builtins.concat(external_string))

    const external_arr = withExternalBuiltins(getConfig(external_array))!.build!.rollupOptions!.external
    expect(external_arr).toEqual(builtins.concat(external_array))

    const external_reg = withExternalBuiltins(getConfig(external_regexp))!.build!.rollupOptions!.external
    expect(external_reg).toEqual(builtins.concat(external_regexp))

    const external_fun = withExternalBuiltins(getConfig(external_function))!.build!.rollupOptions!.external
    expect((external_fun as (source: string) => boolean)('electron')).true
  })
})
