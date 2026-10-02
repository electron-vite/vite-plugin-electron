import type { ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createServer } from 'vite'
import { expect, it, vi } from 'vitest'

import { createElectronPlugin } from '../src/base'
import electron from '../src/index'
import multiEnvElectron from '../src/multi-env'
import { startup } from '../src/startup'
import type { OnStartOptions } from '../src/startup'

it('isolates dev and mock cleanup across a real Vite restart with the same plugin', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'electron-vite-restart-'))
  const cleanups: Array<ReturnType<typeof vi.fn>> = []
  const sessions: Array<{ closed: boolean }> = []
  const plugins = createElectronPlugin({
    prefix: 'restart-test',
    dev(_context, _server, _isESM, session) {
      sessions.push(session)
      const cleanup = vi.fn()
      cleanups.push(cleanup)
      return cleanup
    },
    build() {},
  })
  const listeners = process.listenerCount('SIGINT')
  const server = await createServer({
    configFile: false,
    root,
    plugins,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  })
  try {
    await server.listen()
    expect(cleanups).toHaveLength(1)
    await server.restart()
    expect(cleanups).toHaveLength(2)
    expect(cleanups[0]).toHaveBeenCalledOnce()
    expect(cleanups[1]).not.toHaveBeenCalled()
    expect(sessions[0]?.closed).toBe(true)
    expect(sessions[1]?.closed).toBe(false)
    expect(process.listenerCount('SIGINT')).toBe(listeners + 1)
    expect(await readFile(path.join(root, 'index.html'), 'utf8')).toContain('<!doctype html>')
    await server.close()
    expect(cleanups[1]).toHaveBeenCalledOnce()
    expect(process.listenerCount('SIGINT')).toBe(listeners)
    await expect(readFile(path.join(root, 'index.html'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it.each(['normal', 'multi-env'] as const)(
  '%s keeps real watcher startup and Node child ownership isolated across restart',
  async (mode) => {
    const root = await mkdtemp(path.join(tmpdir(), 'electron-vite-child-restart-'))
    const packageDir = path.join(root, 'node_modules', 'node-electron-fixture')
    const entry = path.join(root, 'main.ts')
    const children: ChildProcess[] = []
    const starts: Promise<void>[] = []
    await mkdir(packageDir, { recursive: true })
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}')
    await writeFile(path.join(packageDir, 'package.json'), '{"main":"index.cjs"}')
    await writeFile(
      path.join(packageDir, 'index.cjs'),
      `module.exports = ${JSON.stringify(process.execPath)}`,
    )
    await writeFile(entry, 'export const generation = 0')
    const onstart: NonNullable<OnStartOptions['onstart']> = vi.fn(
      ({ startup: start }: Parameters<NonNullable<OnStartOptions['onstart']>>[0]) => {
        const started = start(
          [path.resolve('test/fixtures/dev-session-child.cjs')],
          { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
          'node-electron-fixture',
        ).then((spawned) => {
          expect(spawned).toBe(true)
          const child = process.electronApp!
          children.push(child)
          return new Promise<void>((resolve, reject) => {
            const onExit = () => reject(new Error('Fixture exited before ready'))
            child.once('exit', onExit)
            child.once('message', () => {
              child.removeListener('exit', onExit)
              resolve()
            })
          })
        })
        starts.push(started)
        return started
      },
    )
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
    const listeners = process.listenerCount('SIGINT')
    const server = await createServer({
      configFile: false,
      root,
      plugins,
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 },
    })
    try {
      await server.listen()
      await vi.waitFor(() => expect(starts).toHaveLength(1))
      await starts[0]
      const first = children[0]!
      await server.restart()
      await vi.waitFor(() => expect(starts).toHaveLength(2))
      await starts[1]
      const second = children[1]!
      expect(first.exitCode !== null || first.signalCode !== null).toBe(true)
      expect(second.exitCode).toBeNull()
      expect(second.signalCode).toBeNull()
      expect(process.electronApp).toBe(second)
      expect(process.listenerCount('SIGINT')).toBe(listeners + 1)
      expect(await readFile(path.join(root, 'index.html'), 'utf8')).toContain('<!doctype html>')

      // A source edit must reach B's watcher exactly once after A is cleaned up.
      await writeFile(`${entry}.next`, 'export const generation = 1')
      await rename(`${entry}.next`, entry)
      await vi.waitFor(() => expect(starts).toHaveLength(3))
      await starts[2]
      expect(second.exitCode !== null || second.signalCode !== null).toBe(true)
      expect(onstart).toHaveBeenCalledTimes(3)
      if (mode === 'normal') {
        expect(options.vite).not.toHaveProperty('plugins')
      }
      await server.close()
      expect(children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(
        true,
      )
      expect(process.electronApp).toBeUndefined()
      expect(process.listenerCount('SIGINT')).toBe(listeners)
    } finally {
      await server.close()
      await startup.exit()
      await rm(root, { recursive: true, force: true })
    }
  },
  20_000,
)
