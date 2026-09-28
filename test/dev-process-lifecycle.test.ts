import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createElectronPlugin } from '../src/base'
import { startup, triggerStartup } from '../src/startup'

const { spawn, createRequire } = vi.hoisted(() => ({
  spawn: vi.fn(),
  createRequire: vi.fn(),
}))
const originalExitCode = process.exitCode
const originalSigintListeners = new Set(process.listeners('SIGINT'))

vi.mock('node:child_process', () => ({
  spawn,
}))

vi.mock('node:module', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:module')>()),
  createRequire,
}))

function createElectronProcess(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
    send: vi.fn(),
  }) as unknown as ChildProcess
}

describe('dev process lifecycle', () => {
  beforeEach(() => {
    spawn.mockReset()
    createRequire.mockReset()
    createRequire.mockReturnValue(() => '/mock/electron')

    startup.prevent = false
    Reflect.deleteProperty(process, 'electronApp')
    process.exitCode = originalExitCode
  })

  afterEach(() => {
    vi.useRealTimers()
    for (const listener of process.listeners('SIGINT')) {
      if (!originalSigintListeners.has(listener)) {
        process.removeListener('SIGINT', listener)
      }
    }

    Reflect.deleteProperty(process, 'electronApp')
    process.exitCode = originalExitCode
    vi.restoreAllMocks()
  })

  it('waits for Electron to close with SIGTERM by default', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)

    await startup(['.'])

    let settled = false
    const exiting = startup.exit().then(() => {
      settled = true
    })

    expect(electronApp.kill).toHaveBeenCalledWith('SIGTERM')
    expect(settled).toBe(false)

    electronApp.emit('close', 0, 'SIGTERM')
    await exiting

    expect(settled).toBe(true)
    expect(process.electronApp).toBeUndefined()
  })

  it('uses an explicit shutdown signal', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)

    await startup(['.'])
    const exiting = startup.exit('SIGINT')

    expect(electronApp.kill).toHaveBeenCalledExactlyOnceWith('SIGINT')
    electronApp.emit('close', null, 'SIGINT')
    await exiting
  })

  it('passes spawn killSignal through without changing the default shutdown signal', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)

    await startup(['.'], { killSignal: 'SIGINT' })
    expect(spawn).toHaveBeenCalledWith(
      '/mock/electron',
      ['.'],
      expect.objectContaining({ killSignal: 'SIGINT' }),
    )

    const exiting = startup.exit()
    expect(electronApp.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    electronApp.emit('close', null, 'SIGTERM')
    await exiting
  })

  it('shares a pending shutdown between concurrent callers', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)

    await startup(['.'])
    const first = startup.exit()
    const second = startup.exit('SIGINT')

    expect(second).toBe(first)
    expect(electronApp.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    electronApp.emit('close', null, 'SIGTERM')
    await Promise.all([first, second])
    expect(process.electronApp).toBeUndefined()
  })

  it('force kills an unresponsive direct child after the graceful timeout', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)

    await startup(['.'])
    vi.useFakeTimers()
    let settled = false
    const exiting = startup.exit('SIGINT').then(() => {
      settled = true
    })

    expect(electronApp.kill).toHaveBeenCalledExactlyOnceWith('SIGINT')
    await vi.advanceTimersByTimeAsync(4_999)
    expect(electronApp.kill).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(electronApp.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
    expect(settled).toBe(false)

    electronApp.emit('close', null, 'SIGKILL')
    await exiting
    expect(process.electronApp).toBeUndefined()
  })

  it('cancels the force kill after a normal close', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)

    await startup(['.'])
    vi.useFakeTimers()
    const exiting = startup.exit()
    electronApp.emit('close', null, 'SIGTERM')
    await exiting
    await vi.advanceTimersByTimeAsync(5_001)

    expect(electronApp.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
  })

  it('preserves listeners installed by callers', async () => {
    const electronApp = createElectronProcess()
    const userExitListener = vi.fn()
    electronApp.on('exit', userExitListener)
    spawn.mockReturnValue(electronApp)

    await startup(['.'])
    expect(electronApp.listenerCount('exit')).toBe(2)
    const exiting = startup.exit()
    expect(electronApp.listeners('exit')).toEqual([userExitListener])

    electronApp.emit('exit', null, 'SIGTERM')
    electronApp.emit('close', null, 'SIGTERM')
    await exiting
    expect(userExitListener).toHaveBeenCalledOnce()
  })

  it('finishes when the child has already terminated before it can be signalled', async () => {
    const electronApp = createElectronProcess()
    vi.mocked(electronApp.kill).mockReturnValue(false)
    spawn.mockReturnValue(electronApp)

    await startup(['.'])
    await startup.exit()

    expect(process.electronApp).toBeUndefined()
  })

  it('keeps shutdown state tied to the captured child', async () => {
    const firstElectronApp = createElectronProcess()
    const secondElectronApp = createElectronProcess()
    spawn.mockReturnValue(firstElectronApp)

    await startup(['.'])
    const firstExit = startup.exit()
    process.electronApp = secondElectronApp
    const secondExit = startup.exit('SIGINT')

    expect(firstElectronApp.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    expect(secondElectronApp.kill).toHaveBeenCalledExactlyOnceWith('SIGINT')
    firstElectronApp.emit('close', null, 'SIGTERM')
    await firstExit
    expect(process.electronApp).toBe(secondElectronApp)

    secondElectronApp.emit('close', null, 'SIGINT')
    await secondExit
    expect(process.electronApp).toBeUndefined()
  })

  it('exits the parent for a natural exit from exported startup', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await startup(['.'])
    electronApp.emit('exit', 7, null)

    expect(exit).toHaveBeenCalledExactlyOnceWith(7)
    expect(process.electronApp).toBeUndefined()
  })

  it('waits for the old Electron app before starting a replacement', async () => {
    const firstElectronApp = createElectronProcess()
    const secondElectronApp = createElectronProcess()
    spawn.mockReturnValueOnce(firstElectronApp).mockReturnValueOnce(secondElectronApp)

    await startup(['.'])

    const restarting = startup(['.'])

    await vi.waitFor(() => {
      expect(firstElectronApp.kill).toHaveBeenCalledWith('SIGTERM')
    })
    expect(spawn).toHaveBeenCalledTimes(1)

    firstElectronApp.emit('close', 0, 'SIGTERM')
    await restarting

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(process.electronApp).toBe(secondElectronApp)
  })

  it('serializes concurrent startup requests around the current child', async () => {
    const firstElectronApp = createElectronProcess()
    const secondElectronApp = createElectronProcess()
    const thirdElectronApp = createElectronProcess()
    spawn
      .mockReturnValueOnce(firstElectronApp)
      .mockReturnValueOnce(secondElectronApp)
      .mockReturnValueOnce(thirdElectronApp)

    await startup(['.'])
    const secondStart = startup(['.'])

    await vi.waitFor(() => {
      expect(firstElectronApp.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    })
    const thirdStart = startup(['.'])
    expect(spawn).toHaveBeenCalledTimes(1)

    firstElectronApp.emit('close', null, 'SIGTERM')
    await secondStart
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(process.electronApp).toBe(secondElectronApp)

    await vi.waitFor(() => {
      expect(secondElectronApp.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    })
    secondElectronApp.emit('close', null, 'SIGTERM')
    await thirdStart
    expect(spawn).toHaveBeenCalledTimes(3)
    expect(process.electronApp).toBe(thirdElectronApp)
  })

  it('closes the Vite dev server when Electron exits on its own', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)

    const close = vi.fn(async () => {})
    const server = {
      config: { root: '/app' },
      close,
    }

    triggerStartup({} as never, server as never, {})

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledOnce()
    })

    electronApp.emit('exit', 0, null)

    expect(close).toHaveBeenCalledOnce()
    expect(process.electronApp).toBeUndefined()
  })

  it('keeps Vite closing until Electron has closed', async () => {
    const electronApp = createElectronProcess()
    process.electronApp = electronApp

    const plugins = createElectronPlugin({
      prefix: 'vite-plugin-electron-test',
      dev: vi.fn(),
      build: vi.fn(),
    })

    const closeBundle = plugins[0].closeBundle as () => Promise<void>
    let settled = false
    const closing = Promise.all([closeBundle(), closeBundle()]).then(() => {
      settled = true
    })

    await vi.waitFor(() => {
      expect(electronApp.kill).toHaveBeenCalledOnce()
      expect(electronApp.kill).toHaveBeenCalledWith('SIGTERM')
    })
    expect(settled).toBe(false)

    electronApp.emit('close', 0, 'SIGTERM')
    await closing

    expect(settled).toBe(true)
  })

  it('closes Vite and forwards SIGINT before exiting the parent process', async () => {
    const electronApp = createElectronProcess()
    process.electronApp = electronApp

    const plugins = createElectronPlugin({
      prefix: 'vite-plugin-electron-test',
      dev: vi.fn(),
      build: vi.fn(),
    })
    const closeBundle = plugins[0].closeBundle as () => Promise<void>
    const close = vi.fn(async () => {
      await closeBundle()
    })
    const server = {
      config: {
        server: {
          middlewareMode: false,
        },
      },
      httpServer: new EventEmitter(),
      close,
    }
    const existingListeners = new Set(process.listeners('SIGINT'))
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    ;(plugins[0].configureServer as any)?.call({}, server)

    const handler = process.listeners('SIGINT').find((listener) => !existingListeners.has(listener))
    expect(handler).toBeDefined()

    handler?.('SIGINT')

    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledOnce()
      expect(electronApp.kill).toHaveBeenCalledWith('SIGINT')
    })
    expect(exit).not.toHaveBeenCalled()

    electronApp.emit('close', null, 'SIGINT')

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledOnce()
    })
    expect(exit).toHaveBeenCalledWith(130)
  })

  it('leaves SIGINT ownership to a middleware host while closing Electron on request', async () => {
    const electronApp = createElectronProcess()
    process.electronApp = electronApp

    const plugins = createElectronPlugin({
      prefix: 'vite-plugin-electron-test',
      dev: vi.fn(),
      build: vi.fn(),
    })
    const closeBundle = plugins[0].closeBundle as () => Promise<void>
    const close = vi.fn(() => closeBundle())
    const server = {
      config: { server: { middlewareMode: true } },
      httpServer: new EventEmitter(),
      close,
    }
    const existingListeners = process.listeners('SIGINT')

    ;(plugins[0].configureServer as any)?.call({}, server)
    expect(process.listeners('SIGINT')).toEqual(existingListeners)

    let settled = false
    const closing = close().then(() => {
      settled = true
    })
    expect(electronApp.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    expect(settled).toBe(false)

    electronApp.emit('close', null, 'SIGTERM')
    await closing
    expect(process.electronApp).toBeUndefined()
  })
})
