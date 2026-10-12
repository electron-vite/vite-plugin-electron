import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'
import type { Plugin, ViteDevServer } from 'vite'
import { afterEach, beforeAll, expect, it } from 'vitest'

import { createElectronPlugin } from '../../../src/base'
import { startup, triggerStartup } from '../../../src/startup'

const playgroundDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const childFixture = path.join(playgroundDir, 'electron/repro-child.cjs')
const helperFixture = path.join(playgroundDir, 'electron/helper.cjs')
const originalSigintListeners = new Set(process.listeners('SIGINT'))
const originalExitCode = process.exitCode
const startedChildren = new Set<ChildProcess>()
const extraPids = new Set<number>()

let workspace = ''
let electronRoot = ''
let hostPath = ''

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return false
    }
    throw error
  }
}

function killPid(pid: number | undefined): void {
  if (!pid || !isAlive(pid)) {
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // The process may have exited between the liveness check and kill.
  }
}

function track(child: ChildProcess | undefined): ChildProcess | undefined {
  if (child) {
    startedChildren.add(child)
  }
  return child
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function configureDev(plugin: Plugin, server: object): object {
  const environment = {}
  Object.assign(server, { environments: { client: environment } })
  ;(plugin.configureServer as (this: object, server: object) => void).call({}, server)
  return environment
}

function closeDev(plugin: Plugin, environment: object): Promise<void> {
  return (plugin.closeBundle as (this: { environment: object }) => Promise<void>).call({
    environment,
  })
}

function spawnOptions(): import('node:child_process').SpawnOptions {
  return {
    cwd: electronRoot,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  }
}

async function waitForElectronApp(timeout = 10_000): Promise<ChildProcess> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (process.electronApp) {
      return process.electronApp
    }
    await sleep(20)
  }
  throw new Error('process.electronApp was not set')
}

async function waitForMessage(
  child: ChildProcess,
  match: (message: any) => boolean,
  timeout = 10_000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for message from pid=${child.pid}`))
    }, timeout)
    function cleanup() {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('exit', onExit)
    }
    function onMessage(message: unknown) {
      if (match(message)) {
        cleanup()
        resolve(message)
      }
    }
    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      cleanup()
      reject(new Error(`Child exited before message code=${code} signal=${signal}`))
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
  })
}

async function waitForReproReady(child: ChildProcess, timeout = 10_000): Promise<any> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const ready = (child as ChildProcess & { reproReady?: any }).reproReady
    if (ready) {
      return ready
    }
    await sleep(20)
  }
  throw new Error(`Timed out waiting for reproReady on pid=${child.pid}`)
}

async function startTrackedChild(
  context: object,
  server: Pick<ViteDevServer, 'config'> & { close?: () => Promise<void> | void },
  session: { closed: boolean; electronApp?: ChildProcess },
  childMode: string,
): Promise<ChildProcess> {
  let started!: Promise<ChildProcess>
  triggerStartup(
    context as never,
    server as ViteDevServer,
    {
      async onstart({ startup: start }) {
        started = (async () => {
          await start([childFixture, childMode], spawnOptions(), 'node-electron-fixture')
          const child = track(process.electronApp)
          if (!child) {
            throw new Error('startup did not publish process.electronApp')
          }
          const readyPromise = waitForMessage(child, (message) => message?.ready)
          child.send('start')
          const ready = await readyPromise
          ;(child as ChildProcess & { reproReady?: any }).reproReady = ready
          if (typeof ready.helperPid === 'number') {
            extraPids.add(ready.helperPid)
          }
          return child
        })()
        await started
      },
    },
    session,
  )
  return started
}

async function startHost(mode: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [hostPath], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      SHUTDOWN_REPRO_MODE: mode,
      SHUTDOWN_CHILD: childFixture,
      SHUTDOWN_HELPER: helperFixture,
      SHUTDOWN_ELECTRON_ROOT: electronRoot,
    },
  })
  track(child)
  child.stdout?.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk))
  return child
}

beforeAll(async () => {
  process.env.SHUTDOWN_HELPER = helperFixture
  workspace = await mkdtemp(path.join(tmpdir(), 'shutdown-repro-'))
  electronRoot = path.join(workspace, 'app')
  const fixtureDir = path.join(electronRoot, 'node_modules/node-electron-fixture')
  await mkdir(fixtureDir, { recursive: true })
  await symlink(path.resolve('node_modules'), path.join(workspace, 'node_modules'), 'junction')
  await writeFile(path.join(electronRoot, 'package.json'), '{"type":"module"}')
  await writeFile(path.join(electronRoot, 'index.html'), '<!doctype html><title>shutdown</title>')
  await writeFile(path.join(fixtureDir, 'package.json'), '{"main":"index.cjs"}')
  await writeFile(
    path.join(fixtureDir, 'index.cjs'),
    `module.exports = ${JSON.stringify(process.execPath)}`,
  )
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: path.resolve(playgroundDir, 'scripts/host.ts'),
      outDir: path.join(workspace, 'dist'),
      rollupOptions: { output: { entryFileNames: 'host.mjs' } },
    },
  })
  hostPath = path.join(workspace, 'dist/host.mjs')
}, 30_000)

afterEach(() => {
  for (const listener of process.listeners('SIGINT')) {
    if (!originalSigintListeners.has(listener)) {
      process.removeListener('SIGINT', listener)
    }
  }
  for (const child of startedChildren) {
    killPid(child.pid)
  }
  startedChildren.clear()
  for (const pid of extraPids) {
    killPid(pid)
  }
  extraPids.clear()
  killPid(process.electronApp?.pid)
  Reflect.deleteProperty(process, 'electronApp')
  startup.prevent = false
  process.exitCode = originalExitCode
})

it('reaps leftover descendants after the direct child exits on SIGINT', async () => {
  const host = await startHost('descendants')
  const ready = await waitForMessage(host, (message) => message?.helperPid)
  const childPid = ready.pid as number
  const helperPid = ready.helperPid as number
  extraPids.add(helperPid)
  expect(isAlive(helperPid)).toBe(true)

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    host.once('exit', (code, signal) => resolve({ code, signal }))
  })
  host.kill('SIGINT')
  const result = await Promise.race([
    exited,
    sleep(8_000).then(() => ({ code: null, signal: null })),
  ])

  expect(result.code, 'host should wait for the direct child then exit 130').toBe(130)
  expect(isAlive(childPid)).toBe(false)
  expect(isAlive(helperPid), 'plugin-initiated shutdown should reap helper descendants').toBe(false)
  console.log(
    `[ok] leftover-descendants-reaped hostExit=${result.code} childAlive=${isAlive(childPid)} helperAlive=${isAlive(helperPid)}`,
  )
}, 20_000)

it('tree-kills helpers when escalating an unresponsive child to SIGKILL', async () => {
  const host = await startHost('ignore-signals')
  const ready = await waitForMessage(host, (message) => message?.helperPid)
  const childPid = ready.pid as number
  const helperPid = ready.helperPid as number
  extraPids.add(helperPid)

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    host.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const started = Date.now()
  host.kill('SIGINT')
  const result = await exited
  const elapsed = Date.now() - started

  expect(result.code).toBe(130)
  expect(elapsed).toBeGreaterThanOrEqual(4_500)
  expect(isAlive(childPid)).toBe(false)
  expect(isAlive(helperPid), 'SIGKILL escalation should tree-kill helpers').toBe(false)
  console.log(
    `[ok] sigkill-tree-kills-helpers elapsedMs=${elapsed} helperAlive=${isAlive(helperPid)}`,
  )
}, 20_000)

it('escalates a second SIGINT instead of dropping Electron supervision', async () => {
  const host = await startHost('ignore-signals')
  const ready = await waitForMessage(host, (message) => message?.pid)
  const childPid = ready.pid as number
  extraPids.add(childPid)
  const helperPid = typeof ready.helperPid === 'number' ? ready.helperPid : undefined
  if (helperPid) {
    extraPids.add(helperPid)
  }

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    host.once('exit', (code, signal) => resolve({ code, signal }))
  })
  host.kill('SIGINT')
  await sleep(200)
  host.kill('SIGINT')
  const result = await Promise.race([exited, sleep(8_000).then(() => null)])

  expect(result, 'host should stay supervised and exit 130 after escalated kill').not.toBe(null)
  expect(result?.code).toBe(130)
  expect(isAlive(childPid), 'second SIGINT should escalate to SIGKILL of the child').toBe(false)
  if (helperPid) {
    expect(isAlive(helperPid), 'escalated tree kill should reap helpers').toBe(false)
  }
  console.log(
    `[ok] second-sigint-escalates hostCode=${result?.code} childAlive=${isAlive(childPid)}`,
  )
}, 15_000)

it('documents Electron natural exit closing Vite without process.exit', async () => {
  const httpServer = Object.assign(new EventEmitter(), { address: () => null })
  let closed = false
  let exitCalls = 0
  const plugins = createElectronPlugin({
    prefix: 'shutdown-natural-exit',
    async dev(context, server, _isESM, session) {
      await startTrackedChild(context, server, session, 'natural-exit')
    },
    build() {},
  })
  const plugin = plugins[0]!
  const server = {
    config: { root: electronRoot, server: { middlewareMode: true } },
    httpServer,
    close: async () => {
      closed = true
    },
  }
  const originalExit = process.exit
  process.exit = ((code?: number) => {
    exitCalls += 1
    throw new Error(`process.exit(${code})`)
  }) as typeof process.exit
  try {
    const environment = configureDev(plugin, server)
    httpServer.emit('listening')
    await waitForElectronApp()
    await sleep(800)
    expect(closed, 'plugin should close the Vite server when Electron exits').toBe(true)
    expect(exitCalls, 'plugin should not call process.exit on a natural Electron exit').toBe(0)
    console.log(
      `[ok] natural-exit-skips-process-exit serverClosed=${closed} exitCalls=${exitCalls} exitCode=${String(process.exitCode)}`,
    )
    await closeDev(plugin, environment).catch(() => {})
  } finally {
    process.exit = originalExit
  }
}, 15_000)

it('retries close() after a failed startup.exit instead of caching the rejection', async () => {
  const httpServer = Object.assign(new EventEmitter(), { address: () => null })
  const plugins = createElectronPlugin({
    prefix: 'shutdown-failed-close',
    async dev(context, server, _isESM, session) {
      await startTrackedChild(context, server, session, 'stay')
    },
    build() {},
  })
  const plugin = plugins[0]!
  const server = {
    config: { root: electronRoot, server: { middlewareMode: true } },
    httpServer,
  }
  const environment = configureDev(plugin, server)
  httpServer.emit('listening')
  const child = await waitForElectronApp()
  extraPids.add(child.pid!)
  const originalKill = child.kill.bind(child)
  child.kill = () => {
    throw new Error('signal failed')
  }

  await expect(closeDev(plugin, environment)).rejects.toThrow('signal failed')
  expect(child.exitCode).toBeNull()
  expect(child.signalCode).toBeNull()

  let retried = false
  child.kill = ((signal?: NodeJS.Signals) => {
    retried = true
    return originalKill(signal)
  }) as typeof child.kill

  await closeDev(plugin, environment)
  expect(retried, 'second closeSession should kill again after a failed close').toBe(true)
  expect(isAlive(child.pid!)).toBe(false)
  console.log(`[ok] failed-close-is-retryable retried=${retried} childAlive=${isAlive(child.pid!)}`)
}, 15_000)

it('documents SIGINT being sent only after mock/watcher cleanup', async () => {
  const httpServer = Object.assign(new EventEmitter(), { address: () => null })
  let killedAt = 0
  const plugins = createElectronPlugin({
    prefix: 'shutdown-late-signal',
    async dev(context, server, _isESM, session) {
      const child = await startTrackedChild(context, server, session, 'stay')
      const originalKill = child.kill.bind(child)
      child.kill = ((signal?: NodeJS.Signals) => {
        killedAt = Date.now()
        return originalKill(signal)
      }) as typeof child.kill
      return () => sleep(400)
    },
    build() {},
  })
  const plugin = plugins[0]!
  const server = {
    config: { root: electronRoot, server: { middlewareMode: true } },
    httpServer,
  }
  const environment = configureDev(plugin, server)
  httpServer.emit('listening')
  await waitForElectronApp()
  const started = Date.now()
  await closeDev(plugin, environment)
  expect(killedAt).toBeGreaterThan(0)
  expect(killedAt - started).toBeGreaterThanOrEqual(350)
  console.log(`[ok] shutdown-waits-on-cleanup-before-kill delayMs=${killedAt - started}`)
}, 15_000)

it('keeps two plugin instances on separate session-owned children', async () => {
  const firstHttp = Object.assign(new EventEmitter(), { address: () => null })
  const secondHttp = Object.assign(new EventEmitter(), { address: () => null })
  let firstStarted!: Promise<ChildProcess>
  let secondStarted!: Promise<ChildProcess>
  const makePlugin = (label: 'a' | 'b') =>
    createElectronPlugin({
      prefix: `shutdown-two-${label}`,
      async dev(context, server, _isESM, session) {
        const started = startTrackedChild(context, server, session, 'stay')
        if (label === 'a') {
          firstStarted = started
        } else {
          secondStarted = started
        }
        await started
      },
      build() {},
    })[0]!

  const first = makePlugin('a')
  const second = makePlugin('b')
  const firstServer = {
    config: { root: electronRoot, server: { middlewareMode: true } },
    httpServer: firstHttp,
  }
  const secondServer = {
    config: { root: electronRoot, server: { middlewareMode: true } },
    httpServer: secondHttp,
  }
  const firstEnv = configureDev(first, firstServer)
  firstHttp.emit('listening')
  const firstChild = await firstStarted
  const firstPid = firstChild.pid!
  extraPids.add(firstPid)

  const secondEnv = configureDev(second, secondServer)
  secondHttp.emit('listening')
  const secondChild = await secondStarted
  expect(secondChild).toBeDefined()
  expect(secondChild?.pid).not.toBe(firstPid)
  expect(isAlive(firstPid), 'starting B must not kill A through the global alias').toBe(true)
  expect(isAlive(secondChild!.pid!)).toBe(true)
  expect(process.electronApp).toBe(secondChild)
  console.log(
    `[ok] two-plugins-session-scoped firstPid=${firstPid} secondPid=${secondChild?.pid} firstAlive=${isAlive(firstPid)}`,
  )
  await closeDev(second, secondEnv).catch(() => {})
  await closeDev(first, firstEnv).catch(() => {})
  expect(isAlive(firstPid)).toBe(false)
  expect(isAlive(secondChild!.pid!)).toBe(false)
}, 15_000)

it('documents host SIGKILL leaving Electron and helper orphans', async () => {
  const host = await startHost('descendants')
  const ready = await waitForMessage(host, (message) => message?.helperPid)
  const childPid = ready.pid as number
  const helperPid = ready.helperPid as number
  extraPids.add(childPid)
  extraPids.add(helperPid)

  host.kill('SIGKILL')
  await sleep(500)

  expect(isAlive(host.pid!), 'host should be gone after SIGKILL').toBe(false)
  expect(isAlive(childPid), 'Electron direct child should outlive a SIGKILL host').toBe(true)
  expect(isAlive(helperPid), 'detached helper should outlive a SIGKILL host').toBe(true)
  console.log(
    `[ok] host-sigkill-leaves-orphans (OS limitation) childAlive=${isAlive(childPid)} helperAlive=${isAlive(helperPid)}`,
  )
}, 15_000)

it('resolves startup.exit immediately when the child already exited', async () => {
  const httpServer = Object.assign(new EventEmitter(), { address: () => null })
  const plugins = createElectronPlugin({
    prefix: 'shutdown-already-exited',
    async dev(context, server, _isESM, session) {
      await startTrackedChild(context, server, session, 'natural-exit')
    },
    build() {},
  })
  const plugin = plugins[0]!
  const server = {
    config: { root: electronRoot, server: { middlewareMode: true } },
    httpServer,
    close: async () => {},
  }
  const environment = configureDev(plugin, server)
  httpServer.emit('listening')
  const child = await waitForElectronApp()
  await sleep(800)
  expect(child.exitCode).not.toBeNull()

  const started = Date.now()
  await startup.exit()
  expect(Date.now() - started).toBeLessThan(500)
  console.log('[ok] startup-exit-after-child-gone resolves-immediately')
  await closeDev(plugin, environment).catch(() => {})
}, 15_000)

it('shares one in-flight promise across concurrent startup.exit calls', async () => {
  const httpServer = Object.assign(new EventEmitter(), { address: () => null })
  const plugins = createElectronPlugin({
    prefix: 'shutdown-shared-exit-promise',
    async dev(context, server, _isESM, session) {
      await startTrackedChild(context, server, session, 'ignore-signals')
    },
    build() {},
  })
  const plugin = plugins[0]!
  const server = {
    config: { root: electronRoot, server: { middlewareMode: true } },
    httpServer,
    close: async () => {},
  }
  const environment = configureDev(plugin, server)
  httpServer.emit('listening')
  const child = await waitForElectronApp()
  extraPids.add(child.pid!)
  const ready = await waitForReproReady(child)
  const helperPid = ready.helperPid as number
  expect(helperPid).toBeGreaterThan(0)
  extraPids.add(helperPid)

  let killCount = 0
  const originalKill = child.kill.bind(child)
  child.kill = ((signal?: NodeJS.Signals) => {
    killCount += 1
    return originalKill(signal)
  }) as typeof child.kill

  const first = startup.exit('SIGTERM')
  const second = startup.exit('SIGKILL')
  expect(first).toBe(second)

  await expect(first).resolves.toBeUndefined()
  // Shared exitPromise: the second caller must not issue its own immediate kill.
  // SIGTERM is ignored by the fixture, so the 5s escalator may send SIGKILL too.
  expect(killCount).toBeGreaterThanOrEqual(1)
  expect(killCount).toBeLessThanOrEqual(2)
  console.log(`[ok] concurrent-startup-exit-shares-promise killCount=${killCount}`)
  child.kill = originalKill
  await closeDev(plugin, environment).catch(() => {})
}, 20_000)

it('documents Electron natural exit leaving the Vite host event loop alive', async () => {
  const host = await startHost('natural-exit')
  const ready = await waitForMessage(host, (message) => message?.ready || message?.pid)
  const childPid = ready.pid as number

  // Wait for the fixture child to exit on its own.
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline && isAlive(childPid)) {
    await sleep(100)
  }
  expect(isAlive(childPid), 'natural-exit child should have exited').toBe(false)
  expect(isAlive(host.pid!), 'Vite host keeps a leftover timer after server.close()').toBe(true)
  console.log(
    `[ok] natural-exit-leaves-vite-host-alive hostAlive=${isAlive(host.pid!)} childAlive=${isAlive(childPid)}`,
  )
  host.kill('SIGKILL')
}, 15_000)

it('reaps helpers after exitElectron(SIGTERM) of the direct child', async () => {
  const httpServer = Object.assign(new EventEmitter(), { address: () => null })
  const plugins = createElectronPlugin({
    prefix: 'shutdown-helper-survives-sigterm',
    async dev(context, server, _isESM, session) {
      await startTrackedChild(context, server, session, 'descendants')
    },
    build() {},
  })
  const plugin = plugins[0]!
  const server = {
    config: { root: electronRoot, server: { middlewareMode: true } },
    httpServer,
    close: async () => {},
  }
  const environment = configureDev(plugin, server)
  httpServer.emit('listening')
  const child = await waitForElectronApp()
  const childPid = child.pid!
  const ready = await waitForReproReady(child)
  const helperPid = ready.helperPid as number
  expect(helperPid).toBeGreaterThan(0)
  expect(isAlive(helperPid)).toBe(true)

  await startup.exit('SIGTERM')
  expect(isAlive(childPid)).toBe(false)
  expect(isAlive(helperPid), 'exitElectron should reap snapshotted helper descendants').toBe(false)
  console.log(`[ok] helper-reaped-after-exitElectron-sigterm helperAlive=${isAlive(helperPid)}`)
  await closeDev(plugin, environment).catch(() => {})
}, 15_000)

it('documents Windows SIGINT as TerminateProcess, or skips on Unix', async () => {
  if (process.platform !== 'win32') {
    console.log(
      '[skipped] windows-sigint-is-terminateprocess (this host is not Windows; child.kill("SIGINT") is a real POSIX signal here)',
    )
    return
  }

  const child = spawn(process.execPath, [childFixture, 'stay'], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  track(child)
  const ready = waitForMessage(child, (message) => message?.ready)
  child.send('start')
  await ready
  const pid = child.pid!
  child.kill('SIGINT')
  await sleep(400)
  expect(
    isAlive(pid),
    'Windows kill(SIGINT) should terminate the process without a catchable Ctrl+C',
  ).toBe(false)
  console.log(`[ok] windows-sigint-is-terminateprocess pid=${pid}`)
})
