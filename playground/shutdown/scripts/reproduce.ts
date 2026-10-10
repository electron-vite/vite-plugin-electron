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
          const ready = waitForMessage(child, (message) => message?.ready)
          child.send('start')
          await ready
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

it('reproduces leftover descendants after the direct child exits', async () => {
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
  expect(
    isAlive(helperPid),
    'helper spawned by Electron should survive SIGINT of the direct child',
  ).toBe(true)
  console.log(
    `[reproduced] leftover-descendants hostExit=${result.code} childAlive=${isAlive(childPid)} helperAlive=${isAlive(helperPid)}`,
  )
}, 20_000)

it('reproduces SIGKILL of an unresponsive direct child leaving the helper running', async () => {
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
  expect(isAlive(helperPid), 'SIGKILL only targets the direct child pid').toBe(true)
  console.log(
    `[reproduced] sigkill-direct-child-only elapsedMs=${elapsed} helperAlive=${isAlive(helperPid)}`,
  )
}, 20_000)

it('reproduces a second SIGINT dropping the plugin handler while Electron is still shutting down', async () => {
  const host = await startHost('ignore-signals')
  const ready = await waitForMessage(host, (message) => message?.pid)
  const childPid = ready.pid as number
  extraPids.add(childPid)
  if (typeof ready.helperPid === 'number') {
    extraPids.add(ready.helperPid)
  }

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    host.once('exit', (code, signal) => resolve({ code, signal }))
  })
  host.kill('SIGINT')
  await sleep(200)
  host.kill('SIGINT')
  const result = await Promise.race([exited, sleep(2_000).then(() => null)])

  expect(result, 'second SIGINT should default-kill the Vite host before the 5s SIGKILL').not.toBe(
    null,
  )
  expect(result?.code).not.toBe(130)
  expect(result?.signal).toBe('SIGINT')
  expect(isAlive(childPid), 'unresponsive Electron child should still be alive').toBe(true)
  console.log(
    `[reproduced] second-sigint-drops-handler hostSignal=${result?.signal} childAlive=${isAlive(childPid)}`,
  )
}, 15_000)

it('reproduces Electron natural exit closing Vite without process.exit', async () => {
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
      `[reproduced] natural-exit-skips-process-exit serverClosed=${closed} exitCalls=${exitCalls} exitCode=${String(process.exitCode)}`,
    )
    await closeDev(plugin, environment).catch(() => {})
  } finally {
    process.exit = originalExit
  }
}, 15_000)

it('reproduces a failed startup.exit being cached so close() cannot retry', async () => {
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

  await expect(
    closeDev(plugin, environment),
    'second closeSession should reuse the rejected promise and not kill again',
  ).rejects.toThrow('signal failed')
  expect(retried).toBe(false)
  expect(isAlive(child.pid!)).toBe(true)
  child.kill = originalKill
  console.log(
    `[reproduced] failed-close-is-cached retried=${retried} childAlive=${isAlive(child.pid!)}`,
  )
}, 15_000)

it('reproduces SIGINT being sent only after mock/watcher cleanup', async () => {
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
  console.log(`[reproduced] shutdown-waits-on-cleanup-before-kill delayMs=${killedAt - started}`)
}, 15_000)

it('reproduces two plugin instances sharing process.electronApp', async () => {
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
  expect(
    firstChild.exitCode !== null || firstChild.signalCode !== null || !isAlive(firstPid),
    'starting the second plugin kills the first child through process.electronApp',
  ).toBe(true)
  expect(isAlive(secondChild!.pid!)).toBe(true)
  console.log(
    `[reproduced] two-plugins-share-global-child firstPid=${firstPid} secondPid=${secondChild?.pid} firstDead=${!isAlive(firstPid)}`,
  )
  await closeDev(second, secondEnv).catch(() => {})
  await closeDev(first, firstEnv).catch(() => {})
}, 15_000)

it('reproduces Windows SIGINT as TerminateProcess, or documents the Unix difference', async () => {
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
  console.log(`[reproduced] windows-sigint-is-terminateprocess pid=${pid}`)
})
