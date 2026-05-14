import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startup } from '../src/startup'

const spawn = vi.fn()
const createRequire = vi.fn()

vi.mock('node:child_process', () => ({
  spawn,
}))

vi.mock('node:module', () => ({
  createRequire,
}))

const defaultStdio =
  process.platform === 'linux'
    ? ['inherit', 'inherit', 'inherit', 'ignore', 'ipc']
    : ['inherit', 'inherit', 'inherit', 'ipc']

const envKeys = [
  'REMOTE_DEBUGGING_PORT',
  'ELECTRON_IGNORE_CERTIFICATE_ERRORS',
  'ELECTRON_DISABLE_WEB_SECURITY',
  'ELECTRON_INSPECT',
  'ELECTRON_INSPECT_BRK',
] as const

const originalEnvValues = new Map(envKeys.map((key) => [key, process.env[key]] as const))

function restoreEnv() {
  for (const key of envKeys) {
    const value = originalEnvValues.get(key)

    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('src/startup', () => {
  beforeEach(() => {
    restoreEnv()

    spawn.mockReset()
    createRequire.mockReset()

    createRequire.mockReturnValue(() => '/mock/electron')
    spawn.mockReturnValue({
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      kill: vi.fn(),
      send: vi.fn(),
    })

    Reflect.deleteProperty(process, 'electronApp')
  })

  afterEach(() => {
    restoreEnv()
    Reflect.deleteProperty(process, 'electronApp')
  })

  it('appends env-driven Electron CLI flags', async () => {
    process.env.REMOTE_DEBUGGING_PORT = '9222'
    process.env.ELECTRON_IGNORE_CERTIFICATE_ERRORS = '1'
    process.env.ELECTRON_DISABLE_WEB_SECURITY = 'true'
    process.env.ELECTRON_INSPECT = '127.0.0.1:9229'
    process.env.ELECTRON_INSPECT_BRK = '1'

    await startup(['.', '--no-sandbox'])

    expect(spawn).toHaveBeenCalledWith(
      '/mock/electron',
      [
        '.',
        '--no-sandbox',
        '--remote-debugging-port=9222',
        '--ignore-certificate-errors',
        '--disable-web-security',
        '--inspect=127.0.0.1:9229',
        '--inspect-brk',
      ],
      expect.objectContaining({
        stdio: defaultStdio,
      }),
    )
  })

  it('skips env flags when values are false-like or blank', async () => {
    process.env.REMOTE_DEBUGGING_PORT = '   '
    process.env.ELECTRON_IGNORE_CERTIFICATE_ERRORS = 'false'
    process.env.ELECTRON_DISABLE_WEB_SECURITY = '0'
    process.env.ELECTRON_INSPECT = '0'
    process.env.ELECTRON_INSPECT_BRK = 'false'

    await startup(['.'])

    expect(spawn).toHaveBeenCalledWith(
      '/mock/electron',
      ['.'],
      expect.objectContaining({
        stdio: defaultStdio,
      }),
    )
  })
})
