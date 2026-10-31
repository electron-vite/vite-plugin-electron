import type { ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createServer } from 'vite'
import { expect, it, vi } from 'vitest'

import electron from '../src/index'
import multiEnvElectron from '../src/multi-env'
import { startup } from '../src/startup'
import type { OnStartOptions } from '../src/startup'

// Real Vite restarts and watcher rebuilds can exceed vi.waitFor's 1s default under CI load.
const waitOptions = { timeout: 10_000 }

const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null

it.each(['normal', 'multi-env'] as const)(
  '%s: a Vite restart replaces Electron once and stops the old watchers',
  async (mode) => {
    const root = await mkdtemp(path.join(tmpdir(), 'electron-vite-restart-'))
    const packageDir = path.join(root, 'node_modules', 'node-electron-fixture')
    const entry = path.join(root, 'main.ts')
    const children: ChildProcess[] = []
    const starts: Promise<boolean>[] = []
    await mkdir(packageDir, { recursive: true })
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}')
    await writeFile(path.join(packageDir, 'package.json'), '{"main":"index.cjs"}')
    await writeFile(
      path.join(packageDir, 'index.cjs'),
      `module.exports = ${JSON.stringify(process.execPath)}`,
    )
    await writeFile(entry, 'export const generation = 0')

    const onstart: NonNullable<OnStartOptions['onstart']> = vi.fn(({ startup: start }) => {
      const started = start(
        [path.resolve('test/fixtures/restart-child.cjs')],
        { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
        'node-electron-fixture',
      ).then((spawned) => {
        expect(spawned).toBe(true)
        const child = process.electronApp!
        children.push(child)
        // `true` once ready; `false` if a later start replaced it first.
        return new Promise<boolean>((resolve) => {
          const onExit = () => resolve(false)
          child.once('exit', onExit)
          child.once('message', () => {
            child.removeListener('exit', onExit)
            resolve(true)
          })
        })
      })
      starts.push(started)
      return started.then(() => {})
    })
    const buildConfig = { outDir: path.join(root, 'dist-electron'), emptyOutDir: false }
    const options = {
      entry,
      onstart,
      vite: { configFile: false as const, build: buildConfig, logLevel: 'silent' as const },
    }
    const plugins =
      mode === 'normal'
        ? electron(options)
        : multiEnvElectron({ input: entry, onstart, options: { build: buildConfig } })
    const server = await createServer({
      configFile: false,
      root,
      plugins,
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 },
    })
    try {
      await server.listen()
      await vi.waitFor(() => expect(starts).toHaveLength(1), waitOptions)
      expect(await starts[0]).toBe(true)
      const first = children[0]!

      await server.restart()
      await vi.waitFor(() => expect(starts).toHaveLength(2), waitOptions)
      expect(await starts[1]).toBe(true)
      // Settle: the old server's watcher must not start a third app.
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      expect(starts).toHaveLength(2)
      const second = children[1]!
      expect(hasExited(first)).toBe(true)
      expect(hasExited(second)).toBe(false)
      expect(process.electronApp).toBe(second)
      // The mock entry must survive the restart: the new server still needs it.
      expect(await readFile(path.join(root, 'index.html'), 'utf8')).toContain('<!doctype html>')

      // A source edit restarts Electron through the new server's watcher. (One edit can rebuild
      // more than once on some platforms, so only the end state is checked.)
      await writeFile(`${entry}.next`, 'export const generation = 1')
      await rename(`${entry}.next`, entry)
      await vi.waitFor(() => expect(starts.length).toBeGreaterThanOrEqual(3), waitOptions)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      expect(await starts.at(-1)).toBe(true)
      expect(hasExited(second)).toBe(true)
      expect(children.filter((child) => !hasExited(child))).toEqual([process.electronApp])

      if (mode === 'normal') {
        // Dev-only settings must not leak into the user's options.
        expect(options.vite).not.toHaveProperty('plugins')
        expect(buildConfig).not.toHaveProperty('watch')
        expect(buildConfig).not.toHaveProperty('minify')
      }

      await server.close()
      expect(children.every(hasExited)).toBe(true)
      expect(process.electronApp).toBeUndefined()
      await expect(readFile(path.join(root, 'index.html'))).rejects.toMatchObject({
        code: 'ENOENT',
      })

      // Closing the server stops its watcher: later edits start nothing.
      const startCount = starts.length
      await writeFile(`${entry}.next`, 'export const generation = 2')
      await rename(`${entry}.next`, entry)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      expect(starts).toHaveLength(startCount)
    } finally {
      await server.close()
      await startup.exit()
      await rm(root, { recursive: true, force: true })
    }
  },
  30_000,
)
