import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  TREE_KILL_HOOK_SOURCE,
  TREE_KILL_MARKER_KEY,
  TREE_KILL_NODE_OPTIONS_KEY,
  consumeTreeKillMarker,
  createTreeKillMarker,
  ensureTreeKillHook,
  withTreeKillHook,
} from '../src/tree-kill-hook'

// Stands in for Vite's resolved config.cacheDir.
const hookCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-kill-hook-vite-cache-'))
const withHook = (env: Record<string, string | undefined>, marker?: string) =>
  withTreeKillHook(env, ensureTreeKillHook(hookCacheDir), marker)

afterAll(() => {
  fs.rmSync(hookCacheDir, { recursive: true, force: true })
})

describe('tree-kill hook', () => {
  it("writes the hook under Vite's cacheDir and replaces a file whose content does not match", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-kill-hook-cache-'))
    try {
      const file = ensureTreeKillHook(cacheDir)
      expect(path.dirname(file)).toBe(path.join(cacheDir, 'vite-plugin-electron'))
      expect(fs.readFileSync(file, 'utf8')).toBe(TREE_KILL_HOOK_SOURCE)
      expect(ensureTreeKillHook(cacheDir)).toBe(file)
      fs.writeFileSync(file, 'process.exit(1)\n')
      expect(ensureTreeKillHook(cacheDir)).toBe(file)
      expect(fs.readFileSync(file, 'utf8')).toBe(TREE_KILL_HOOK_SOURCE)
    } finally {
      fs.rmSync(cacheDir, { recursive: true, force: true })
    }
  })

  it('preloads the hook and keeps the original NODE_OPTIONS for restoring', () => {
    const file = 'C:\\Program Files\\app "x"\\hook.cjs'
    const env = withTreeKillHook({ NODE_OPTIONS: '--max-old-space-size=4096', FOO: '1' }, file)
    expect(env.NODE_OPTIONS).toBe(`--max-old-space-size=4096 --require ${JSON.stringify(file)}`)
    expect(env[TREE_KILL_NODE_OPTIONS_KEY]).toBe('--max-old-space-size=4096')
    expect(env.FOO).toBe('1')

    const bare = withTreeKillHook({}, file)
    expect(bare.NODE_OPTIONS).toBe(`--require ${JSON.stringify(file)}`)
    expect(bare[TREE_KILL_NODE_OPTIONS_KEY]).toBe('')
    expect(TREE_KILL_MARKER_KEY in bare).toBe(false)

    expect(withTreeKillHook({}, file, '/m')[TREE_KILL_MARKER_KEY]).toBe('/m')
  })

  it('creates a unique marker next to the hook and consumes it once', () => {
    const hook = ensureTreeKillHook(hookCacheDir)
    const marker = createTreeKillMarker(hook)
    expect(path.dirname(marker)).toBe(path.dirname(hook))
    expect(createTreeKillMarker(hook)).not.toBe(marker)

    expect(consumeTreeKillMarker(undefined)).toBe(false)
    expect(consumeTreeKillMarker(marker)).toBe(false)
    fs.writeFileSync(marker, '')
    expect(consumeTreeKillMarker(marker)).toBe(true)
    expect(fs.existsSync(marker)).toBe(false)
    expect(consumeTreeKillMarker(marker)).toBe(false)
  })

  it('restores NODE_OPTIONS for the app and does nothing outside the Electron main process', () => {
    const script = `console.log(JSON.stringify({
      nodeOptions: process.env.NODE_OPTIONS ?? null,
      key: ${JSON.stringify(TREE_KILL_NODE_OPTIONS_KEY)} in process.env,
      markerKey: ${JSON.stringify(TREE_KILL_MARKER_KEY)} in process.env,
      exitListeners: process.listenerCount('exit'),
    }))`
    const marker = createTreeKillMarker(ensureTreeKillHook(hookCacheDir))
    const run = (env: Record<string, string | undefined>) =>
      JSON.parse(
        execFileSync(process.execPath, ['-e', script], {
          encoding: 'utf8',
          env: withHook(env, marker),
        }),
      )

    const { NODE_OPTIONS: _ignored, ...base } = process.env
    expect(run({ ...base, NODE_OPTIONS: '--no-deprecation' })).toEqual({
      nodeOptions: '--no-deprecation',
      key: false,
      markerKey: false,
      exitListeners: 0,
    })
    expect(run(base)).toEqual({ nodeOptions: null, key: false, markerKey: false, exitListeners: 0 })
    // Outside the Electron main process the hook does no cleanup, so it never claims it did.
    expect(fs.existsSync(marker)).toBe(false)
  })

  it('kills processes the main process started when it exits', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-kill-hook-'))
    try {
      // Pose as the Electron main process so the serialized hook runs its kill path in plain Node.
      const asBrowser = path.join(dir, 'as-browser.cjs')
      fs.writeFileSync(asBrowser, "process.type = 'browser'\n")
      const main = `
        const { spawn } = require('node:child_process')
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore',
          detached: true,
        })
        child.unref()
        console.log(child.pid)
        setTimeout(() => process.exit(0), 300)
      `
      const { NODE_OPTIONS: _ignored, ...base } = process.env
      const marker = path.join(dir, 'exited-marker')
      const env = withHook(
        {
          ...base,
          NODE_OPTIONS: `--require ${JSON.stringify(asBrowser)}`,
        },
        marker,
      )
      // The hook appends itself after the user's options, so `process.type` is set first.
      const childPid = Number(
        execFileSync(process.execPath, ['-e', main], { encoding: 'utf8', env }).trim(),
      )
      expect(childPid).toBeGreaterThan(0)
      await new Promise((resolve) => setTimeout(resolve, 300))
      let alive = true
      try {
        process.kill(childPid, 0)
      } catch {
        alive = false
      }
      if (alive) {
        process.kill(childPid, 'SIGKILL')
      }
      expect(alive, 'hook should kill the detached child on exit').toBe(false)
      expect(fs.existsSync(marker), 'hook should report a successful cleanup').toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)
})
