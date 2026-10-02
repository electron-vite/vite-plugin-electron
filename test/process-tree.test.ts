import type { ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, it } from 'vitest'

import { startup } from '../src/startup'

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

async function waitForExit(pid: number, timeout = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!isAlive(pid)) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return !isAlive(pid)
}

function waitForDescendant(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for descendant process'))
    }, 5_000)
    function cleanup() {
      clearTimeout(timeout)
      child.removeListener('message', onMessage)
      child.removeListener('exit', onExit)
    }
    function onMessage(message: unknown) {
      if (typeof message !== 'object' || message === null || !('descendantPid' in message)) {
        return
      }
      const pid = message.descendantPid
      if (typeof pid !== 'number') {
        return
      }
      cleanup()
      resolve(pid)
    }
    function onExit() {
      cleanup()
      reject(new Error('Electron process exited before reporting its descendant'))
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
  })
}

it('resolves on direct exit even while a descendant holds its pipe open', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vite-plugin-electron-tree-'))
  const packageDir = path.join(root, 'node_modules', 'e2e-electron')
  let descendantPid: number | undefined
  let directChild: ChildProcess | undefined

  try {
    await mkdir(packageDir, { recursive: true })
    await writeFile(path.join(packageDir, 'package.json'), '{"main":"index.cjs"}')
    await writeFile(
      path.join(packageDir, 'index.cjs'),
      `module.exports = ${JSON.stringify(process.execPath)}\n`,
    )

    // Use the real startup() resolution/spawn/exit path, not a mocked ChildProcess.
    await startup(
      [path.resolve('test/fixtures/process-tree/parent.cjs')],
      { cwd: root, stdio: ['ignore', 'ignore', 'ignore', 'ipc', 'pipe'] },
      'e2e-electron',
    )
    directChild = process.electronApp
    if (!directChild?.pid) {
      throw new Error('Electron process did not start')
    }

    const ready = waitForDescendant(directChild)
    startup.send('start')
    descendantPid = await ready
    expect(isAlive(descendantPid)).toBe(true)

    let closed = false
    directChild.once('close', () => {
      closed = true
    })
    const exiting = startup.exit()
    const finished = await Promise.race([
      exiting.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
    ])
    expect(finished, 'shutdown should not wait for the descendant-held pipe').toBe(true)
    expect(await waitForExit(directChild.pid)).toBe(true)
    expect(isAlive(descendantPid)).toBe(true)
    expect(closed).toBe(false)

    await startup(
      [path.resolve('test/fixtures/process-tree/parent.cjs')],
      { cwd: root, stdio: ['ignore', 'ignore', 'ignore', 'ipc', 'pipe'] },
      'e2e-electron',
    )
    expect(process.electronApp?.pid).not.toBe(directChild.pid)
    expect(isAlive(descendantPid)).toBe(true)
  } finally {
    if (process.electronApp && process.electronApp !== directChild) {
      await startup.exit()
    }
    if (descendantPid && isAlive(descendantPid)) {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(descendantPid), '/F'], { stdio: 'ignore' })
      } else {
        process.kill(descendantPid, 'SIGKILL')
      }
      await waitForExit(descendantPid)
    }
    if (directChild && directChild.exitCode === null && directChild.signalCode === null) {
      await startup.exit()
    }
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)
