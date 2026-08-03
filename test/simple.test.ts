import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ElectronOptions } from '../src/index'
import electronSimple from '../src/simple'
import { defaultPreloadOnstart } from '../src/startup'

vi.mock('../src/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/index')>()
  return {
    ...original,
    default: vi.fn(() => [] as ReturnType<(typeof original)['default']>),
  }
})

vi.mock('../src/utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils')>()
  return {
    ...original,
    checkESModule: vi.fn(() => false),
  }
})

async function getPassedOptions(): Promise<ElectronOptions[]> {
  const { default: electron } = await import('../src/index')
  const mock = vi.mocked(electron)
  const calls = mock.mock.calls
  expect(calls).toHaveLength(1)
  return calls[0][0] as ElectronOptions[]
}

describe('src/simple', () => {
  beforeEach(async () => {
    const { default: electron } = await import('../src/index')
    vi.mocked(electron).mockClear()
  })

  it('no preload produces only the main entry', async () => {
    await electronSimple({ main: { entry: 'electron/main.ts' } })

    const options = await getPassedOptions()
    expect(options).toHaveLength(1)
  })

  it('single preload object produces one preload entry (regression)', async () => {
    await electronSimple({
      main: { entry: 'electron/main.ts' },
      preload: { input: 'electron/preload.ts' },
    })

    const options = await getPassedOptions()
    expect(options).toHaveLength(2)

    const preload = options[1]
    expect(preload.onstart).toBe(defaultPreloadOnstart)
    // input is forwarded into the vite build config
    expect(
      (preload.vite?.build as any)?.rolldownOptions?.input,
    ).toBe('electron/preload.ts')
  })

  it('array of preload objects produces one entry per item', async () => {
    await electronSimple({
      main: { entry: 'electron/main.ts' },
      preload: [
        { input: 'electron/preload.ts' },
        { input: 'electron/preload-worker.ts' },
      ],
    })

    const options = await getPassedOptions()
    expect(options).toHaveLength(3) // main + 2 preloads

    expect(options[1].onstart).toBe(defaultPreloadOnstart)
    expect((options[1].vite?.build as any)?.rolldownOptions?.input).toBe(
      'electron/preload.ts',
    )

    expect(options[2].onstart).toBe(defaultPreloadOnstart)
    expect((options[2].vite?.build as any)?.rolldownOptions?.input).toBe(
      'electron/preload-worker.ts',
    )
  })

  it('custom onstart in preload overrides defaultPreloadOnstart', async () => {
    const customOnstart = vi.fn()

    await electronSimple({
      main: { entry: 'electron/main.ts' },
      preload: { input: 'electron/preload.ts', onstart: customOnstart },
    })

    const options = await getPassedOptions()
    expect(options[1].onstart).toBe(customOnstart)
    expect(options[1].onstart).not.toBe(defaultPreloadOnstart)
  })

  it('custom onstart in each preload array item overrides defaultPreloadOnstart', async () => {
    const customOnstart1 = vi.fn()
    const customOnstart2 = vi.fn()

    await electronSimple({
      main: { entry: 'electron/main.ts' },
      preload: [
        { input: 'electron/preload.ts', onstart: customOnstart1 },
        { input: 'electron/preload-worker.ts', onstart: customOnstart2 },
      ],
    })

    const options = await getPassedOptions()
    expect(options).toHaveLength(3)
    expect(options[1].onstart).toBe(customOnstart1)
    expect(options[2].onstart).toBe(customOnstart2)
  })

  it('vite config in preload is merged with the default preload config', async () => {
    await electronSimple({
      main: { entry: 'electron/main.ts' },
      preload: {
        input: 'electron/preload.ts',
        vite: { define: { __PRELOAD__: JSON.stringify(true) } },
      },
    })

    const options = await getPassedOptions()
    const preload = options[1]
    expect(preload.vite?.define).toMatchObject({ __PRELOAD__: 'true' })
    // default preload platform is still set
    expect(
      (preload.vite?.build as any)?.rolldownOptions?.platform,
    ).toBe('node')
  })
})
