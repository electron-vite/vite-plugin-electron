import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { build } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'

let root: string
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'electron-dev-shutdown-'))
  await symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'junction')
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
      ssr: path.resolve('test/fixtures/dev-shutdown.ts'),
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

for (const mode of ['restart', 'pipes', 'middleware']) {
  it.skipIf(mode === 'restart' && process.platform === 'win32')(
    `${mode} releases dev process resources after the direct child exits`,
    async () => {
      const runner = spawn(
        process.execPath,
        [
          path.join(root, 'dist/runner.mjs'),
          mode,
          path.join(root, 'app'),
          path.resolve(
            mode === 'restart'
              ? 'test/fixtures/dev-shutdown-child.cjs'
              : 'test/fixtures/process-tree/parent.cjs',
          ),
        ],
        { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
      )
      let output = ''
      runner.stdout?.on('data', (data) => {
        output += data
      })
      runner.stderr?.on('data', (data) => {
        output += data
      })
      const pids: number[] = []
      let resolveReady!: () => void
      let resolveCleaned!: () => void
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve
      })
      const cleaned = new Promise<void>((resolve) => {
        resolveCleaned = resolve
      })
      runner.on('message', (message: any) => {
        if (message.ready) {
          pids.push(message.childPid)
          if (message.descendantPid) {
            pids.push(message.descendantPid)
          }
          resolveReady()
        }
        if (message.cleaned) {
          resolveCleaned()
        }
      })
      const exited = new Promise<number | null>((resolve) => runner.once('exit', resolve))
      async function within<T>(promise: Promise<T>, timeout: number): Promise<T> {
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
        if (mode === 'restart') {
          runner.kill('SIGINT')
          expect(await within(exited, 8_000)).toBe(130)
          expect(isAlive(pids[0]!)).toBe(false)
        } else if (mode === 'pipes') {
          expect(await within(exited, 3_000)).toBe(0)
          expect(isAlive(pids[0]!)).toBe(false)
          expect(isAlive(pids[1]!)).toBe(true)
        } else {
          await within(cleaned, 3_000)
          expect(runner.exitCode).toBeNull()
          expect(runner.signalCode).toBeNull()
          expect(isAlive(pids[1]!)).toBe(true)
        }
      } finally {
        for (const pid of pids) {
          if (isAlive(pid)) {
            process.kill(pid, 'SIGKILL')
          }
        }
        if (runner.exitCode === null && runner.signalCode === null) {
          runner.kill('SIGKILL')
        }
        await exited
        for (const stream of runner.stdio) {
          stream?.destroy()
        }
      }
    },
    25_000,
  )
}
