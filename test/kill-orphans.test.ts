import { execFileSync } from 'node:child_process'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  killOrphanedChildrenSync,
  killPidsSync,
  parseWindowsProcessTable,
} from '../src/process-tree'

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync: vi.fn(),
}))

const mockedExec = vi.mocked(execFileSync)
const originalPlatform = process.platform

/** WMI DMTF datetime for 2026-10-31 hh:mm:ss UTC. */
const at = (minute: number, second: number, hour = 10) =>
  `20261031${[hour, minute, second].map((n) => String(n).padStart(2, '0')).join('')}.000000+000`
const ms = (minute: number, second: number) => Date.UTC(2026, 9, 31, 10, minute, second)

// Electron (pid 100) ran from 10:00:00 until it exited at 10:00:08.
const ELECTRON_STARTED = ms(0, 0)
const ELECTRON_EXITED = ms(0, 8)
const WMIC_OUTPUT = [
  '',
  'Node,CreationDate,ParentProcessId,ProcessId',
  'HOST,,0,0',
  `HOST,${at(0, 0)},0,4`,
  // Orphans of the dead Electron and a grandchild.
  `HOST,${at(0, 5)},100,200`,
  `HOST,${at(0, 5)},100,201`,
  `HOST,${at(0, 6)},200,300`,
  // Stale parent ids: created before the process that now owns (or owned) that pid.
  `HOST,${at(0, 0, 9)},100,500`,
  `HOST,${at(59, 0, 9)},200,600`,
  // pid 100 was reused after Electron exited; its child is not an orphan.
  `HOST,${at(0, 10)},1,100`,
  `HOST,${at(0, 11)},100,700`,
  `HOST,${at(0, 5)},999,400`,
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
  vi.restoreAllMocks()
})

it('parses wmic CSV into parent -> children and creation times', () => {
  const table = parseWindowsProcessTable(WMIC_OUTPUT)
  expect(table.children.get(100)).toEqual([200, 201, 500, 700])
  expect(table.children.get(200)).toEqual([300, 600])
  expect(table.children.get(0)).toEqual([4])
  expect(table.created.get(200)).toBe(ms(0, 5))
  expect(table.created.get(500)).toBe(Date.UTC(2026, 9, 31, 9, 0, 0))
  expect(table.created.has(0)).toBe(false)
})

it('applies the DMTF UTC offset', () => {
  const table = parseWindowsProcessTable('H,20261031180000.500000+480,1,2')
  expect(table.created.get(2)).toBe(Date.UTC(2026, 9, 31, 10, 0, 0, 500))
})

it('taskkills only orphans created while the dead pid was alive, children first', () => {
  setPlatform('win32')
  vi.spyOn(Date, 'now').mockReturnValue(ELECTRON_EXITED)
  mockedExec.mockImplementation(((file: string) => {
    if (file === 'wmic') {
      return WMIC_OUTPUT
    }
    if (file === 'taskkill') {
      throw new Error('already gone')
    }
    return ''
  }) as typeof execFileSync)

  expect(killOrphanedChildrenSync(100, ELECTRON_STARTED)).toEqual([200, 201])
  const taskkills = mockedExec.mock.calls.filter(([file]) => file === 'taskkill')
  // No /T: taskkill's own tree walk would follow the stale parent ids of 500, 600 and 700.
  expect(taskkills.map(([, args]) => args)).toEqual([
    ['/F', '/PID', '300', '/PID', '200', '/PID', '201'],
  ])
})

it('falls back to PowerShell when wmic is unavailable on win32', () => {
  setPlatform('win32')
  mockedExec.mockImplementation(((file: string) => {
    if (file === 'wmic') {
      throw new Error('wmic not found')
    }
    if (file === 'powershell.exe') {
      // Epoch milliseconds; an empty CreationDate is treated as unknown.
      return `P,${ms(0, 5)},100,200\r\nP,,100,201\r\nP,${ms(0, 30)},100,202\r\n`
    }
    return ''
  }) as typeof execFileSync)

  vi.spyOn(Date, 'now').mockReturnValue(ELECTRON_EXITED)
  expect(killOrphanedChildrenSync(100, ELECTRON_STARTED)).toEqual([200, 201])
})

it('is a no-op when wmic and PowerShell both fail on win32', () => {
  setPlatform('win32')
  mockedExec.mockImplementation(() => {
    throw new Error('not found')
  })
  expect(killOrphanedChildrenSync(100)).toEqual([])
  expect(mockedExec).toHaveBeenCalledTimes(2)
})

it('is a no-op on POSIX', () => {
  setPlatform('darwin')
  expect(killOrphanedChildrenSync(100)).toEqual([])
  expect(mockedExec).not.toHaveBeenCalled()
})

it('skips snapshot PIDs that are gone or were reused after the snapshot on win32', () => {
  setPlatform('win32')
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('gone'), { code: 'ESRCH' })
  })
  mockedExec.mockImplementation(((file: string) => {
    if (file === 'wmic') {
      // 201 now belongs to a process started after the snapshot; 202 is gone.
      return `H,${at(0, 5)},100,200\r\nH,${at(0, 30)},1,201\r\n`
    }
    return ''
  }) as typeof execFileSync)

  killPidsSync([200, 201, 202], ms(0, 10))
  const taskkills = mockedExec.mock.calls.filter(([file]) => file === 'taskkill')
  expect(taskkills.map(([, args]) => args)).toEqual([['/F', '/PID', '200']])
})

it('skips snapshot PIDs reused after the snapshot on POSIX', () => {
  setPlatform('linux')
  const killed: number[] = []
  vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
    if (signal === 'SIGKILL') {
      killed.push(pid)
      return true
    }
    throw Object.assign(new Error('gone'), { code: 'ESRCH' })
  }) as typeof process.kill)
  mockedExec.mockImplementation(((file: string, args: string[]) => {
    if (file === 'ps') {
      expect(args).toEqual(['-o', 'pid=,lstart=', '-p', '200,201,202'])
      return '  200 Sat Oct 31 09:59:00 2026\n  201 Sat Oct 31 10:00:30 2026\n'
    }
    return ''
  }) as typeof execFileSync)

  killPidsSync([200, 201, 202], Date.parse('Sat Oct 31 10:00:00 2026'))
  expect(killed).toEqual([200])
})

it('kills every PID when no snapshot time is given', () => {
  setPlatform('linux')
  const killed: number[] = []
  vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
    if (signal === 'SIGKILL') {
      killed.push(pid)
      return true
    }
    throw Object.assign(new Error('gone'), { code: 'ESRCH' })
  }) as typeof process.kill)

  killPidsSync([200, 201])
  expect(killed).toEqual([200, 201])
  expect(mockedExec).not.toHaveBeenCalled()
})
