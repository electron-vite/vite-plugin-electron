import { EventEmitter } from 'node:events'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startup, triggerStartup } from '../src/startup'

const { spawn, createRequire } = vi.hoisted(() => ({ spawn: vi.fn(), createRequire: vi.fn() }))

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

/** A child process stand-in that exits shortly after being signaled. */
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    pid: 1234,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    send: vi.fn(),
    kill: vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
      setTimeout(() => {
        child.signalCode = signal
        child.emit('exit', null, signal)
      }, 10)
      return true
    }),
  })
  return child
}

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
    spawn.mockImplementation(() => fakeChild())

    Reflect.deleteProperty(process, 'electronApp')
  })

  afterEach(async () => {
    await startup.exit()
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

  it('resolves Electron from spawn cwd before process cwd', async () => {
    const appPackageJson = path.join('/app', 'package.json')

    createRequire.mockImplementation((filename: string) => {
      if (filename === appPackageJson) {
        return () => '/app/electron'
      }

      return () => '/workspace/electron'
    })

    await startup(['.'], { cwd: '/app' })

    expect(createRequire).toHaveBeenCalledWith(appPackageJson)
    expect(spawn).toHaveBeenCalledWith(
      '/app/electron',
      ['.'],
      expect.objectContaining({
        cwd: '/app',
        stdio: defaultStdio,
      }),
    )
  })
  it('serializes concurrent starts so no Electron app is left behind', async () => {
    const results = await Promise.all([startup(['.']), startup(['.'])])

    expect(results).toEqual([true, true])
    expect(spawn).toHaveBeenCalledTimes(2)
    const [first, second] = spawn.mock.results.map((result) => result.value)
    // The second start replaced the first instead of racing it.
    expect(first.kill).toHaveBeenCalledOnce()
    expect(first.signalCode).not.toBeNull()
    expect(second.kill).not.toHaveBeenCalled()
    expect(process.electronApp).toBe(second)
  })

  it('logs plugin-driven startup failures instead of rejecting', async () => {
    const error = vi.fn()
    const server = { config: { root: '/app', logger: { error } } } as any

    triggerStartup({} as any, server, {
      onstart() {
        throw new Error('sync failure')
      },
    })
    triggerStartup({} as any, server, {
      async onstart() {
        throw new Error('async failure')
      },
    })

    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2))
    expect(error.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining('sync failure'),
      expect.stringContaining('async failure'),
    ])
  })
})
