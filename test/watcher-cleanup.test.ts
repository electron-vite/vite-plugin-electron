import { EventEmitter } from 'node:events'
import path from 'node:path'

import { build, createBuilder } from 'vite'
import type { Plugin } from 'vite'
import { afterEach, expect, it, vi } from 'vitest'

import { closeWatchers } from '../src/base'
import electron from '../src/index'
import multiEnvElectron from '../src/multi-env'

vi.mock('vite', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vite')>()),
  build: vi.fn(),
  createBuilder: vi.fn(),
}))

afterEach(() => {
  vi.mocked(build).mockReset()
  vi.mocked(createBuilder).mockReset()
})

/** Start the dev plugin against a fake server whose second Electron build fails. */
async function startDevWithFailingBuild(plugins: Plugin[]) {
  const devPlugin = plugins[0]!
  const environment = {}
  const httpServer = Object.assign(new EventEmitter(), { address: () => null })
  const server = {
    config: {
      root: path.resolve('.'),
      mode: 'development',
      envDir: path.resolve('.'),
      envPrefix: 'VITE_',
      server: { middlewareMode: true },
    },
    environments: { client: environment },
    httpServer,
  }
  ;(devPlugin.configureServer as any).call({}, server)
  const [listener] = httpServer.rawListeners('listening') as unknown as Array<{
    listener: () => Promise<void>
  }>
  await expect(listener!.listener()).rejects.toThrow('second build failed')
  // Closing the server must not hang or throw on the failed start.
  await (devPlugin.closeBundle as any).call({ environment })
}

it('closes earlier watchers when a later build fails', async () => {
  const close = vi.fn(async () => {})
  vi.mocked(build)
    .mockResolvedValueOnce({ close } as never)
    .mockRejectedValueOnce(new Error('second build failed'))
  await startDevWithFailingBuild(electron([{}, {}]))
  expect(close).toHaveBeenCalledOnce()
})

it('closes earlier multi-env watchers when a later build fails', async () => {
  const close = vi.fn(async () => {})
  const builder = {
    environments: { electron_0: { isBuilt: false }, electron_1: { isBuilt: false } },
    build: vi
      .fn()
      .mockResolvedValueOnce({ close })
      .mockRejectedValueOnce(new Error('second build failed')),
  }
  vi.mocked(createBuilder).mockResolvedValue(builder as never)
  await startDevWithFailingBuild(multiEnvElectron([{}, {}]))
  expect(close).toHaveBeenCalledOnce()
})

it('attempts every watcher close even if one throws', async () => {
  const first = vi.fn((): Promise<void> => {
    throw new Error('first close failed')
  })
  const second = vi.fn(async () => {})
  await expect(closeWatchers([{ close: first }, { close: second }])).rejects.toThrow(
    'first close failed',
  )
  expect(first).toHaveBeenCalledOnce()
  expect(second).toHaveBeenCalledOnce()
})
