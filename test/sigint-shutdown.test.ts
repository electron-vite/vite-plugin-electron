import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { build } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'

// https://github.com/electron-vite/vite-plugin-electron/issues/311
// Ctrl+C must not end the Vite process before the Electron app has exited.

let root: string
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'electron-sigint-'))
  await symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'junction')
  // `startup()` resolves its electron package from the project root; point it at plain Node.
  const packageDir = path.join(root, 'app/node_modules/node-electron-fixture')
  await mkdir(packageDir, { recursive: true })
  await writeFile(path.join(packageDir, 'package.json'), '{"main":"index.cjs"}')
  await writeFile(
    path.join(packageDir, 'index.cjs'),
    `module.exports = ${JSON.stringify(process.execPath)}`,
  )
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: path.resolve('test/fixtures/sigint-runner.ts'),
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

async function run(mode: 'slow' | 'stubborn', body: (ctx: RunContext) => Promise<void>) {
  const marker = path.join(root, `${mode}.marker`)
  const runner = spawn(
    process.execPath,
    [
      path.join(root, 'dist/runner.mjs'),
      mode,
      path.join(root, 'app'),
      path.resolve('test/fixtures/sigint-child.cjs'),
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
      marker,
      sigint: () => runner.send('sigint'),
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

interface RunContext {
  marker: string
  sigint: () => void
  exited: (timeout: number) => Promise<number | null>
  childPid: () => number
}

it('waits for Electron to exit before the Vite process exits on Ctrl+C', async () => {
  await run('slow', async (ctx) => {
    ctx.sigint()
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
    ctx.sigint()
    // On POSIX the child ignores termination signals, so the first Ctrl+C is still waiting on it.
    // (On Windows kill() terminates it outright, so there is nothing left to wait for.)
    if (process.platform !== 'win32') {
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(isAlive(ctx.childPid())).toBe(true)
    }
    ctx.sigint()
    expect(await ctx.exited(3_000)).toBe(130)
    const pid = ctx.childPid()
    const deadline = Date.now() + 3_000
    while (isAlive(pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(isAlive(pid)).toBe(false)
  })
}, 25_000)
