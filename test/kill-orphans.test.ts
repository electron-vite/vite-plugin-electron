import { execFileSync } from 'node:child_process'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { killOrphanedChildrenSync, parseWindowsProcessTable } from '../src/utils'

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync: vi.fn(),
}))

const mockedExec = vi.mocked(execFileSync)
const originalPlatform = process.platform

const WMIC_OUTPUT = [
  '',
  'Node,ParentProcessId,ProcessId',
  'HOST,0,0',
  'HOST,0,4',
  'HOST,100,200',
  'HOST,100,201',
  'HOST,200,300',
  'HOST,999,400',
  '',
].join('\r\n')

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

beforeEach(() => {
  mockedExec.mockReset()
})

afterEach(() => {
  setPlatform(originalPlatform)
})

it('parses wmic CSV into a ppid -> pids map', () => {
  const table = parseWindowsProcessTable(WMIC_OUTPUT)
  expect(table.get(100)).toEqual([200, 201])
  expect(table.get(200)).toEqual([300])
  expect(table.get(0)).toEqual([4])
})

it('taskkills each direct orphan of the dead pid with /T /F on win32', () => {
  setPlatform('win32')
  mockedExec.mockImplementation(((file: string) => {
    if (file === 'wmic') {
      return WMIC_OUTPUT
    }
    if (file === 'taskkill') {
      throw new Error('already gone')
    }
    return ''
  }) as typeof execFileSync)

  expect(killOrphanedChildrenSync(100)).toEqual([200, 201])
  const taskkills = mockedExec.mock.calls.filter(([file]) => file === 'taskkill')
  expect(taskkills.map(([, args]) => args)).toEqual([
    ['/PID', '200', '/T', '/F'],
    ['/PID', '201', '/T', '/F'],
  ])
})

it('is a no-op when wmic fails on win32', () => {
  setPlatform('win32')
  mockedExec.mockImplementation(() => {
    throw new Error('wmic not found')
  })
  expect(killOrphanedChildrenSync(100)).toEqual([])
  expect(mockedExec).toHaveBeenCalledTimes(1)
})

it('is a no-op on POSIX', () => {
  setPlatform('darwin')
  expect(killOrphanedChildrenSync(100)).toEqual([])
  expect(mockedExec).not.toHaveBeenCalled()
})
