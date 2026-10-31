import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { build } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'

// How the Vite dev process and the Electron app end together. The runner is a real Vite dev
// server in its own process; plain Node stands in for Electron (test/fixtures/dev-shutdown-child.cjs).

let root: string
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'electron-dev-shutdown-'))
  await symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'junction')
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: path.resolve('test/fixtures/dev-shutdown-runner.ts'),
      outDir: path.join(root, 'dist'),
      rollupOptions: { output: { entryFileNames: 'runner.mjs' } },
    },
  })
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

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

async function waitForDeath(pid: number, timeout = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (isAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return !isAlive(pid)
}

interface RunContext {
  app: string
  marker: string
  send: (message: 'sigint' | 'host-exit') => void
  exited: (timeout: number) => Promise<number | null>
  childPid: () => number
}

async function run(
  mode: 'slow' | 'stubborn' | 'quit',
  body: (ctx: RunContext) => Promise<void>,
): Promise<void> {
  // A fresh project per run: a forced exit may leave the mock index.html behind.
  const app = await mkdtemp(path.join(root, 'app-'))
  const marker = path.join(app, 'marker')
  // `startup()` resolves its electron package from the project root; point it at plain Node.
  const packageDir = path.join(app, 'node_modules/node-electron-fixture')
  await mkdir(packageDir, { recursive: true })
  await writeFile(path.join(packageDir, 'package.json'), '{"main":"index.cjs"}')
  await writeFile(
    path.join(packageDir, 'index.cjs'),
    `module.exports = ${JSON.stringify(process.execPath)}`,
  )
  const runner = spawn(
    process.execPath,
    [
      path.join(root, 'dist/runner.mjs'),
      mode,
      app,
      path.resolve('test/fixtures/dev-shutdown-child.cjs'),
      marker,
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  )
  let output = ''
  runner.stdout?.on('data', (data) => (output += data))
  runner.stderr?.on('data', (data) => (output += data))
  let childPid = 0
  const ready = new Promise<void>((resolve) => {
    runner.on('message', (message: any) => {
      if (message.ready) {
        childPid = message.childPid
        resolve()
      }
    })
  })
  const exited = new Promise<number | null>((resolve) => runner.once('exit', resolve))
  const within = async <T>(promise: Promise<T>, timeout: number): Promise<T> => {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out: ${output}`)), timeout)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    await within(ready, 10_000)
    await body({
      app,
      marker,
      send: (message) => runner.send(message),
      exited: (timeout) => within(exited, timeout),
      childPid: () => childPid,
    })
  } finally {
    if (childPid && isAlive(childPid)) {
      process.kill(childPid, 'SIGKILL')
    }
    if (runner.exitCode === null && runner.signalCode === null) {
      runner.kill('SIGKILL')
    }
    await exited
    for (const stream of runner.stdio) {
      stream?.destroy()
    }
  }
}

// https://github.com/electron-vite/vite-plugin-electron/issues/311
it('waits for Electron to exit before the Vite process exits on Ctrl+C', async () => {
  await run('slow', async (ctx) => {
    ctx.send('sigint')
    expect(await ctx.exited(8_000)).toBe(130)
    // The child needs ~300ms to shut down; the host must not have left before it finished.
    // (On Windows `kill()` terminates immediately, so only the exit itself is checked.)
    if (process.platform !== 'win32') {
      expect(existsSync(ctx.marker)).toBe(true)
    }
    expect(isAlive(ctx.childPid())).toBe(false)
  })
}, 25_000)

it('force-exits on a second Ctrl+C without leaving Electron behind', async () => {
  await run('stubborn', async (ctx) => {
    ctx.send('sigint')
    // On POSIX the child ignores termination signals, so the first Ctrl+C is still waiting on it.
    // (On Windows `kill()` terminates it outright, so there is nothing left to wait for.)
    if (process.platform !== 'win32') {
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(isAlive(ctx.childPid())).toBe(true)
    }
    ctx.send('sigint')
    expect(await ctx.exited(3_000)).toBe(130)
    expect(await waitForDeath(ctx.childPid())).toBe(true)
  })
}, 25_000)

it('closes the dev server and exits with its code when Electron quits by itself', async () => {
  await run('quit', async (ctx) => {
    expect(await ctx.exited(8_000)).toBe(3)
    // The project has no index.html, so the plugin served a mock; closing the server removes it.
    expect(existsSync(path.join(ctx.app, 'index.html'))).toBe(false)
  })
}, 25_000)

it('stops Electron when the Vite process exits by another path', async () => {
  // Only discriminating on POSIX: on Windows the Node stand-in dies with its parent anyway.
  await run('slow', async (ctx) => {
    ctx.send('host-exit')
    expect(await ctx.exited(8_000)).toBe(0)
    expect(await waitForDeath(ctx.childPid())).toBe(true)
  })
}, 25_000)
