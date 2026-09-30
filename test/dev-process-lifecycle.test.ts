import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createElectronPlugin } from '../src/base'
import { exitElectron, startup, triggerStartup } from '../src/startup'

import { closeDev, configureDev } from './helpers/dev-session'

const { spawn, createRequire } = vi.hoisted(() => ({
  spawn: vi.fn(),
  createRequire: vi.fn(),
}))
const { setupMockHtml } = vi.hoisted(() => ({ setupMockHtml: vi.fn() }))
const originalExitCode = process.exitCode
const originalSigintListeners = new Set(process.listeners('SIGINT'))

vi.mock('node:child_process', () => ({
  spawn,
}))

vi.mock('node:module', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:module')>()),
  createRequire,
}))
vi.mock('../src/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils')>()),
  setupMockHtml,
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
    setupMockHtml.mockReset()

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

  it('waits for Electron to exit with SIGTERM by default', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)

    await startup(['.'])

    let settled = false
    const exiting = startup.exit().then(() => {
      settled = true
    })

    expect(electronApp.kill).toHaveBeenCalledWith('SIGTERM')
    expect(settled).toBe(false)

    electronApp.emit('exit', 0, 'SIGTERM')
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
    electronApp.emit('exit', null, 'SIGINT')
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
    electronApp.emit('exit', null, 'SIGTERM')
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
    electronApp.emit('exit', null, 'SIGTERM')
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

    electronApp.emit('exit', null, 'SIGKILL')
    await exiting
    expect(process.electronApp).toBeUndefined()
  })

  it('cancels the force kill after a normal exit', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)

    await startup(['.'])
    vi.useFakeTimers()
    const exiting = startup.exit()
    electronApp.emit('exit', null, 'SIGTERM')
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
    expect(electronApp.listeners('exit')).toContain(userExitListener)
    expect(electronApp.listenerCount('exit')).toBe(2)

    electronApp.emit('exit', null, 'SIGTERM')
    electronApp.emit('close', null, 'SIGTERM')
    await exiting
    expect(userExitListener).toHaveBeenCalledOnce()
  })

  it('finishes when the child has already terminated before it can be signalled', async () => {
    const electronApp = createElectronProcess()
    vi.mocked(electronApp.kill).mockImplementation(() => {
      Object.defineProperty(electronApp, 'exitCode', { value: 0 })
      return false
    })
    spawn.mockReturnValue(electronApp)

    await startup(['.'])
    await startup.exit()

    expect(process.electronApp).toBeUndefined()
  })

  it('does not signal an already-exited child', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)
    await startup(['.'])
    Object.defineProperty(electronApp, 'exitCode', { value: 0 })
    await startup.exit()
    expect(electronApp.kill).not.toHaveBeenCalled()
    expect(process.electronApp).toBeUndefined()
  })

  it('retains a live child after shutdown fails so it can be retried', async () => {
    const electronApp = createElectronProcess()
    vi.mocked(electronApp.kill).mockImplementationOnce(() => {
      throw new Error('signal failed')
    })
    spawn.mockReturnValue(electronApp)
    await startup(['.'])

    await expect(startup.exit()).rejects.toThrow('signal failed')
    expect(process.electronApp).toBe(electronApp)

    const retry = startup.exit()
    expect(electronApp.kill).toHaveBeenCalledTimes(2)
    electronApp.emit('exit', null, 'SIGTERM')
    await retry
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
    firstElectronApp.emit('exit', null, 'SIGTERM')
    await firstExit
    expect(process.electronApp).toBe(secondElectronApp)

    secondElectronApp.emit('exit', null, 'SIGINT')
    await secondExit
    expect(process.electronApp).toBeUndefined()
  })

  it('retries a failed old-child shutdown without losing the new child lifecycle', async () => {
    const old = createElectronProcess()
    const current = createElectronProcess()
    spawn.mockReturnValue(old)
    await startup()
    vi.mocked(old.kill).mockImplementationOnce(() => {
      throw new Error('old signal failed')
    })
    const failed = exitElectron(old)
    process.electronApp = current
    const currentExit = startup.exit('SIGINT')
    await expect(failed).rejects.toThrow('old signal failed')
    const retry = exitElectron(old)
    expect(old.kill).toHaveBeenCalledTimes(2)
    expect(startup.exit()).toBe(currentExit)
    old.emit('exit', null, 'SIGTERM')
    await retry
    expect(process.electronApp).toBe(current)
    current.emit('exit', null, 'SIGINT')
    await currentExit
  })

  it('retains a live child and session ownership when kill returns false', async () => {
    const child = createElectronProcess()
    spawn.mockReturnValue(child)
    const session = { closed: false, electronApp: undefined as ChildProcess | undefined }
    let start!: () => Promise<boolean>
    triggerStartup(
      {} as never,
      { config: { root: '/app' } } as never,
      {
        onstart({ startup }) {
          start = () => startup()
        },
      },
      session,
    )
    await start()
    vi.mocked(child.kill).mockReturnValueOnce(false)
    await expect(exitElectron(child)).rejects.toThrow('Failed to send SIGTERM')
    expect(process.electronApp).toBe(child)
    expect(session.electronApp).toBe(child)
    const retry = exitElectron(child)
    child.emit('exit', null, 'SIGTERM')
    await retry
    expect(session.electronApp).toBeUndefined()
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

    firstElectronApp.emit('exit', 0, 'SIGTERM')
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

    firstElectronApp.emit('exit', null, 'SIGTERM')
    await secondStart
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(process.electronApp).toBe(secondElectronApp)

    await vi.waitFor(() => {
      expect(secondElectronApp.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    })
    secondElectronApp.emit('exit', null, 'SIGTERM')
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

  it('closes dev build watchers when Electron exits naturally', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)
    const closeWatcher = vi.fn(async () => {})
    const plugins = createElectronPlugin({
      prefix: 'vite-plugin-electron-test',
      dev(context, server, _isESM, session) {
        triggerStartup(context, server, {}, session)
        return closeWatcher
      },
      build: vi.fn(),
    })
    const closeBundle = () => closeDev(plugins[0]!)
    const httpServer = Object.assign(new EventEmitter(), { address: () => null })
    const server = {
      config: { root: '/app', server: { middlewareMode: false } },
      httpServer,
      close: vi.fn(() => closeBundle()),
    }

    configureDev(plugins[0]!, server)
    httpServer.emit('listening')
    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalledOnce()
    })

    electronApp.emit('exit', 0, null)
    await vi.waitFor(() => {
      expect(closeWatcher).toHaveBeenCalledOnce()
    })
    expect(server.close).toHaveBeenCalledOnce()
    expect(process.electronApp).toBeUndefined()

    await closeBundle()
    expect(closeWatcher).toHaveBeenCalledOnce()
  })

  it('waits for dev setup before closing its watcher', async () => {
    let finishDev!: (cleanup: () => Promise<void>) => void
    const dev = vi.fn(
      () =>
        new Promise<() => Promise<void>>((resolve) => {
          finishDev = resolve
        }),
    )
    const closeWatcher = vi.fn(async () => {})
    const plugins = createElectronPlugin({
      prefix: 'vite-plugin-electron-test',
      dev,
      build: vi.fn(),
    })
    const closeBundle = () => closeDev(plugins[0]!)
    const httpServer = Object.assign(new EventEmitter(), { address: () => null })
    const server = {
      config: { server: { middlewareMode: false } },
      httpServer,
    }

    configureDev(plugins[0]!, server)
    httpServer.emit('listening')
    expect(dev).toHaveBeenCalledOnce()

    let settled = false
    const closing = closeBundle().then(() => {
      settled = true
    })
    expect(settled).toBe(false)

    finishDev(closeWatcher)
    await closing
    expect(closeWatcher).toHaveBeenCalledOnce()
  })

  it('does not start from a delayed onstart after the dev session closes', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)
    let resume!: () => void
    let finished!: Promise<void>
    const deferred = new Promise<void>((resolve) => (resume = resolve))
    const plugins = createElectronPlugin({
      prefix: 'vite-plugin-electron-test',
      dev(context, server, _isESM, session) {
        triggerStartup(
          context,
          server,
          {
            async onstart({ startup: start }) {
              finished = (async () => {
                await deferred
                await start()
              })()
              await finished
            },
          },
          session,
        )
      },
      build: vi.fn(),
    })
    const server = {
      config: { root: '/app', server: { middlewareMode: true } },
      httpServer: Object.assign(new EventEmitter(), { address: () => null }),
    }
    configureDev(plugins[0]!, server)
    server.httpServer.emit('listening')
    await closeDev(plugins[0]!)
    resume()
    await finished
    expect(spawn).not.toHaveBeenCalled()
  })

  it('cancels a queued startup while another shutdown is pending', async () => {
    const old = createElectronProcess()
    spawn.mockReturnValue(old)
    await startup(['.'])
    const server = { config: { root: '/app' } }
    const session = { closed: false }
    let start!: () => Promise<boolean>
    triggerStartup(
      {} as never,
      server as never,
      {
        onstart({ startup: startWithRoot }) {
          start = () => startWithRoot()
        },
      },
      session,
    )

    const first = start()
    await vi.waitFor(() => expect(old.kill).toHaveBeenCalledOnce())
    const queued = start()
    await vi.waitFor(() => expect(createRequire).toHaveBeenCalledTimes(3))
    await Promise.resolve()
    session.closed = true
    old.emit('exit', null, 'SIGTERM')
    expect(await first).toBe(false)
    expect(await queued).toBe(false)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('gives a new Vite dev session a fresh startup token', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)
    const starts: Array<() => Promise<boolean>> = []
    const plugins = createElectronPlugin({
      prefix: 'vite-plugin-electron-test',
      dev(context, server, _isESM, session) {
        triggerStartup(
          context,
          server,
          {
            onstart({ startup: start }) {
              starts.push(() => start())
            },
          },
          session,
        )
      },
      build: vi.fn(),
    })
    const configure = (server: any) => configureDev(plugins[0]!, server)
    const server = () => ({
      config: { root: '/app', server: { middlewareMode: true } },
      httpServer: Object.assign(new EventEmitter(), { address: () => null }),
    })
    const first = server()
    configure(first)
    first.httpServer.emit('listening')
    await closeDev(plugins[0]!)

    const second = server()
    configure(second)
    second.httpServer.emit('listening')
    expect(await starts[0]!()).toBe(false)
    expect(await starts[1]!()).toBe(true)
    expect(spawn).toHaveBeenCalledOnce()
    const closing = closeDev(plugins[0]!)
    await vi.waitFor(() => expect(electronApp.kill).toHaveBeenCalledOnce())
    electronApp.emit('exit', null, 'SIGTERM')
    await closing
  })

  it('keeps B alive and supervised when A closes after B has spawned', async () => {
    const childA = createElectronProcess()
    const childB = createElectronProcess()
    spawn.mockReturnValueOnce(childA).mockReturnValueOnce(childB)
    const cleanupA = vi.fn(async () => {})
    const cleanupB = vi.fn(async () => {})
    const mockA = vi.fn(async () => {})
    const mockB = vi.fn(async () => {})
    setupMockHtml.mockReturnValueOnce(mockA).mockReturnValueOnce(mockB)
    const starts: Array<() => Promise<boolean>> = []
    const sessions: Array<{ closed: boolean; electronApp?: ChildProcess }> = []
    const plugins = createElectronPlugin({
      prefix: 'overlap-test',
      dev(context, server, _isESM, session) {
        sessions.push(session)
        triggerStartup(
          context,
          server,
          {
            onstart({ startup }) {
              starts.push(() => startup())
            },
          },
          session,
        )
        return sessions.length === 1 ? cleanupA : cleanupB
      },
      build() {},
    })
    const plugin = plugins[0]!
    const makeServer = (root: string) => ({
      config: { root, build: {}, server: { middlewareMode: false } },
      httpServer: Object.assign(new EventEmitter(), { address: () => null }),
      close: vi.fn(async () => {}),
    })
    const a = makeServer('/session-a')
    ;(plugin.configResolved as any)(a.config)
    const envA = configureDev(plugin, a)
    a.httpServer.emit('listening')
    await starts[0]!()
    expect(sessions[0]?.electronApp).toBe(childA)

    const b = makeServer('/session-b')
    ;(plugin.configResolved as any)(b.config)
    const envB = configureDev(plugin, b)
    b.close.mockImplementation(() => closeDev(plugin, envB))
    b.httpServer.emit('listening')
    const startingB = starts[1]!()
    await vi.waitFor(() => expect(childA.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM'))
    expect(spawn).toHaveBeenCalledTimes(1)
    childA.emit('exit', null, 'SIGTERM')
    expect(await startingB).toBe(true)
    expect(sessions[0]?.electronApp).toBeUndefined()
    expect(sessions[1]?.electronApp).toBe(childB)

    const listeners = process.listeners('SIGINT')
    const closingA = closeDev(plugin, envA)
    expect(closeDev(plugin, envA)).toBe(closingA)
    await closingA
    expect(sessions[0]?.closed).toBe(true)
    expect(sessions[1]?.closed).toBe(false)
    expect(cleanupA).toHaveBeenCalledOnce()
    expect(mockA).toHaveBeenCalledOnce()
    expect(cleanupB).not.toHaveBeenCalled()
    expect(mockB).not.toHaveBeenCalled()
    expect(childB.kill).not.toHaveBeenCalled()
    expect(process.electronApp).toBe(childB)
    expect(process.listeners('SIGINT')).toEqual(listeners)

    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const handler = listeners.find((listener) => !originalSigintListeners.has(listener))
    handler!('SIGINT')
    await vi.waitFor(() => expect(childB.kill).toHaveBeenCalledExactlyOnceWith('SIGINT'))
    expect(b.close).toHaveBeenCalledOnce()
    expect(a.close).not.toHaveBeenCalled()
    childB.emit('exit', null, 'SIGINT')
    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(130))
    expect(cleanupB).toHaveBeenCalledOnce()
    expect(mockB).toHaveBeenCalledOnce()
    expect(process.electronApp).toBeUndefined()
  })

  it('reloads preload without restarting main, and ignores closed-session reloads', async () => {
    const child = createElectronProcess()
    spawn.mockReturnValue(child)
    await startup()
    const session = { closed: false }
    const send = vi.fn()
    const server = { config: { root: '/app' }, hot: { send } }
    let reload!: () => void
    triggerStartup(
      {} as never,
      server as never,
      {
        onstart(args) {
          reload = args.reload
        },
      },
      session,
    )
    reload()
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'full-reload' })
    expect(child.send).toHaveBeenCalledExactlyOnceWith('electron-vite&type=hot-reload')
    expect(spawn).toHaveBeenCalledOnce()
    session.closed = true
    reload()
    expect(send).toHaveBeenCalledOnce()
    expect(child.send).toHaveBeenCalledOnce()
    const closing = startup.exit()
    child.emit('exit', null, 'SIGTERM')
    await closing
  })

  it('attempts Electron shutdown even when mock cleanup fails', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)
    setupMockHtml.mockReturnValue(async () => {
      throw new Error('mock cleanup failed')
    })
    const plugins = createElectronPlugin({
      prefix: 'test',
      dev(context, server, _isESM, session) {
        triggerStartup(context, server, {}, session)
      },
      build: vi.fn(),
    })
    const config = { root: '/app', build: {}, server: { middlewareMode: true } }
    ;(plugins[0]!.configResolved as any)?.(config)
    const server = {
      config,
      httpServer: Object.assign(new EventEmitter(), { address: () => null }),
    }
    configureDev(plugins[0]!, server)
    server.httpServer.emit('listening')
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
    const closing = closeDev(plugins[0]!)
    await vi.waitFor(() => expect(electronApp.kill).toHaveBeenCalledWith('SIGTERM'))
    electronApp.emit('exit', null, 'SIGTERM')
    await expect(closing).rejects.toThrow('mock cleanup failed')
  })

  it('keeps Vite closing until Electron has exited', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)

    const plugins = createElectronPlugin({
      prefix: 'vite-plugin-electron-test',
      dev(context, server, _isESM, session) {
        triggerStartup(context, server, {}, session)
      },
      build: vi.fn(),
    })

    const closeBundle = () => closeDev(plugins[0]!)
    const server = {
      config: { root: '/app', server: { middlewareMode: true } },
      httpServer: Object.assign(new EventEmitter(), { address: () => null }),
    }
    configureDev(plugins[0]!, server)
    server.httpServer.emit('listening')
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
    let settled = false
    const closing = Promise.all([closeBundle(), closeBundle()]).then(() => {
      settled = true
    })

    await vi.waitFor(() => {
      expect(electronApp.kill).toHaveBeenCalledOnce()
      expect(electronApp.kill).toHaveBeenCalledWith('SIGTERM')
    })
    expect(settled).toBe(false)

    electronApp.emit('exit', 0, 'SIGTERM')
    await closing

    expect(settled).toBe(true)
  })

  it('closes Vite and forwards SIGINT before exiting the parent process', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)

    const plugins = createElectronPlugin({
      prefix: 'vite-plugin-electron-test',
      dev(context, server, _isESM, session) {
        triggerStartup(context, server, {}, session)
      },
      build: vi.fn(),
    })
    const closeBundle = () => closeDev(plugins[0]!)
    const close = vi.fn(async () => {
      await closeBundle()
    })
    const server = {
      config: {
        root: '/app',
        server: {
          middlewareMode: false,
        },
      },
      httpServer: Object.assign(new EventEmitter(), { address: () => null }),
      close,
    }
    const existingListeners = new Set(process.listeners('SIGINT'))
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    configureDev(plugins[0]!, server)
    server.httpServer.emit('listening')
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())

    const handler = process.listeners('SIGINT').find((listener) => !existingListeners.has(listener))
    expect(handler).toBeDefined()

    handler?.('SIGINT')

    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledOnce()
      expect(electronApp.kill).toHaveBeenCalledWith('SIGINT')
    })
    expect(exit).not.toHaveBeenCalled()

    electronApp.emit('exit', null, 'SIGINT')

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledOnce()
    })
    expect(exit).toHaveBeenCalledWith(130)
  })

  it('leaves SIGINT ownership to a middleware host while closing Electron on request', async () => {
    const electronApp = createElectronProcess()
    spawn.mockReturnValue(electronApp)

    const plugins = createElectronPlugin({
      prefix: 'vite-plugin-electron-test',
      dev(context, server, _isESM, session) {
        triggerStartup(context, server, {}, session)
      },
      build: vi.fn(),
    })
    const closeBundle = () => closeDev(plugins[0]!)
    const close = vi.fn(() => closeBundle())
    const server = {
      config: { root: '/app', server: { middlewareMode: true } },
      httpServer: Object.assign(new EventEmitter(), { address: () => null }),
      close,
    }
    const existingListeners = process.listeners('SIGINT')

    configureDev(plugins[0]!, server)
    expect(process.listeners('SIGINT')).toEqual(existingListeners)
    server.httpServer.emit('listening')
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())

    let settled = false
    const closing = close().then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(electronApp.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM'))
    expect(settled).toBe(false)

    electronApp.emit('exit', null, 'SIGTERM')
    await closing
    expect(process.electronApp).toBeUndefined()
  })
})
