import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createElectronPlugin } from '../src/base'
import { startup, triggerStartup } from '../src/startup'

const spawn = vi.fn()
const createRequire = vi.fn()
const originalExitCode = process.exitCode
const originalSigintListeners = new Set(process.listeners('SIGINT'))

vi.mock('node:child_process', () => ({
  spawn,
}))

vi.mock('node:module', () => ({
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
    for (const listener of process.listeners('SIGINT')) {
      if (!originalSigintListeners.has(listener)) {
        process.removeListener('SIGINT', listener)
      }
    }

    Reflect.deleteProperty(process, 'electronApp')
    process.exitCode = originalExitCode
    vi.restoreAllMocks()
  })

  it('waits for Electron to close and honors the configured kill signal', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)

    await startup(['.'], { killSignal: 'SIGINT' })

    let settled = false
    const exiting = startup.exit().then(() => {
      settled = true
    })

    await vi.waitFor(() => {
      expect(electronApp.kill).toHaveBeenCalledWith('SIGINT')
    })
    expect(settled).toBe(false)

    electronApp.emit('close', 0, 'SIGINT')
    await exiting

    expect(settled).toBe(true)
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

    const handler = process
      .listeners('SIGINT')
      .find((listener) => !existingListeners.has(listener))
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
    expect(process.exitCode).toBe(130)
  })
})
