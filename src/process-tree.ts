// Process-table helpers for `startup.treeKill`. All of them are synchronous and best-effort:
// process listings race with exits, and every failure to list or kill is swallowed.
import { execFileSync } from 'node:child_process'
/**
 * List descendant PIDs of `pid` (not including `pid` itself), parents before children.
 * Best-effort: process listings can race with exits.
 *
 * On Windows a process keeps its dead parent's id in `ParentProcessId` and PIDs are reused, so a
 * process only counts as a child when it was created no earlier than its parent.
 */
export function listDescendantPids(pid: number): number[] {
  if (!pid || pid <= 0) {
    return []
  }
  if (process.platform === 'win32') {
    const table = readWindowsProcessTable()
    return table ? walkWindowsTree(table, pid) : []
  }
  const table = readPosixProcessTable()
  if (!table) {
    return []
  }
  const result: number[] = []
  const stack = [pid]
  const seen = new Set<number>([pid])
  while (stack.length) {
    const current = stack.pop()!
    for (const child of table.get(current) ?? []) {
      if (!seen.has(child)) {
        seen.add(child)
        result.push(child)
        stack.push(child)
      }
    }
  }
  return result
}

/**
 * Read the whole POSIX process table once as parent pid -> child pids.
 *
 * `ps -A -o pid=,ppid=` is accepted by procps (Linux), BSD/macOS and busybox alike, unlike the
 * GNU-only `ps --ppid` or the macOS-only `pgrep -P`; one call also replaces one spawn per level
 * of the tree. Returns `undefined` when `ps` fails.
 */
function readPosixProcessTable(): Map<number, number[]> | undefined {
  let out: string
  try {
    out = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return
  }
  const children = new Map<number, number[]>()
  for (const line of out.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (!match) {
      continue
    }
    const pid = Number(match[1])
    const ppid = Number(match[2])
    if (pid === ppid) {
      continue
    }
    const list = children.get(ppid)
    if (list) {
      list.push(pid)
    } else {
      children.set(ppid, [pid])
    }
  }
  return children
}

export interface WindowsProcessTable {
  /** Parent pid -> child pids. */
  children: Map<number, number[]>
  /** Pid -> creation time in epoch milliseconds, when known. */
  created: Map<number, number>
}

// WMI DMTF datetime: yyyymmddHHMMSS.ffffff±UUU (UUU = UTC offset in minutes).
const DMTF_DATETIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{3})\d*([+-]\d+)$/

/** Parse a WMI DMTF datetime or epoch milliseconds into epoch milliseconds. */
function parseCreationDate(value: string | undefined): number | undefined {
  if (!value) {
    return
  }
  if (/^\d+$/.test(value)) {
    return Number(value)
  }
  const match = DMTF_DATETIME.exec(value)
  if (!match) {
    return
  }
  const [, year, month, day, hour, minute, second, millisecond, offset] = match.map(Number)
  return Date.UTC(year!, month! - 1, day!, hour!, minute!, second!, millisecond!) - offset! * 60_000
}

/**
 * Parse `wmic process get CreationDate,ParentProcessId,ProcessId /FORMAT:CSV` (or the PowerShell
 * equivalent). Rows end with `CreationDate,ParentProcessId,ProcessId`; `CreationDate` is optional.
 */
export function parseWindowsProcessTable(out: string): WindowsProcessTable {
  const children = new Map<number, number[]>()
  const created = new Map<number, number>()
  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(',')
    if (parts.length < 3) {
      continue
    }
    const ppid = Number(parts[parts.length - 2])
    const pid = Number(parts[parts.length - 1])
    // Skip the CSV header and malformed rows; wmic lists the System Idle Process as pid 0.
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0 || pid === ppid) {
      continue
    }
    if (parts.length >= 4) {
      const time = parseCreationDate(parts[parts.length - 3])
      if (time !== undefined) {
        created.set(pid, time)
      }
    }
    const list = children.get(ppid)
    if (list) {
      list.push(pid)
    } else {
      children.set(ppid, [pid])
    }
  }
  return { children, created }
}

function readWindowsProcessTable(): WindowsProcessTable | undefined {
  const options: import('node:child_process').ExecFileSyncOptionsWithStringEncoding = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  }
  try {
    return parseWindowsProcessTable(
      execFileSync(
        'wmic',
        ['process', 'get', 'CreationDate,ParentProcessId,ProcessId', '/FORMAT:CSV'],
        options,
      ),
    )
  } catch {
    // wmic is removed from recent Windows 10/11 builds; fall back to PowerShell (same CSV shape).
  }
  try {
    return parseWindowsProcessTable(
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Get-CimInstance Win32_Process | ForEach-Object { $c = if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { '' }; 'P,' + $c + ',' + $_.ParentProcessId + ',' + $_.ProcessId }",
        ],
        options,
      ),
    )
  } catch {
    return undefined
  }
}

/** `true` unless `time` is known and falls outside `[notBefore, notAfter]`. */
function createdWithin(time: number | undefined, notBefore?: number, notAfter?: number): boolean {
  if (time === undefined) {
    return true
  }
  return (
    (notBefore === undefined || time >= notBefore) && (notAfter === undefined || time <= notAfter)
  )
}

/**
 * Walk the Windows process tree from `rootPid`, parents before children. A row only counts as a
 * child when it was created no earlier than its parent: otherwise its `ParentProcessId` is stale
 * and names an earlier process whose PID was later reused.
 */
function walkWindowsTree(table: WindowsProcessTable, rootPid: number): number[] {
  const result: number[] = []
  const stack = [rootPid]
  const seen = new Set<number>([rootPid])
  while (stack.length) {
    const current = stack.pop()!
    const parentCreated = table.created.get(current)
    for (const child of table.children.get(current) ?? []) {
      if (seen.has(child) || !createdWithin(table.created.get(child), parentCreated)) {
        continue
      }
      seen.add(child)
      result.push(child)
      stack.push(child)
    }
  }
  return result
}

/** `taskkill /F` the given PIDs (no `/T`: its tree walk trusts stale parent ids). */
function taskkillSync(pids: number[]): void {
  if (!pids.length) {
    return
  }
  const args = ['/F']
  for (const pid of pids) {
    args.push('/PID', String(pid))
  }
  try {
    execFileSync('taskkill', args, { stdio: 'ignore', windowsHide: true })
  } catch {
    // Some targets may already be gone (taskkill exit 128).
  }
}

/**
 * Best-effort cleanup of processes orphaned by a direct child that already exited on its own
 * (e.g. Electron `app.quit()` / `process.exit()`), when no pre-exit snapshot exists.
 *
 * Windows keeps the dead parent's id in `ParentProcessId`, so the orphans are still findable;
 * each is killed with its descendants. Because PIDs are reused, only processes created while the
 * dead child was alive (`startedAt` until now) count as its orphans.
 *
 * POSIX re-parents orphans to init/subreaper, so they cannot be found by the dead pid; this is a
 * no-op there (plugin-initiated shutdown still reaps them via its pre-kill snapshot).
 *
 * Known limitation: on POSIX, if Electron exits by itself (`app.quit()`, a crash, SIGKILL from
 * outside) the only cleanup is the in-process hook, which cannot run after a crash or SIGKILL.
 * v0.x had the same gap. A possible fix is to spawn Electron with `detached: true` (its own
 * process group) and `process.kill(-pid)` afterwards: orphans stay in the group after being
 * re-parented, so they can be found without the dead pid. It is not done because `detached`
 * moves Electron out of the terminal's foreground group (Ctrl+C would no longer reach it
 * directly), and apps that call `setsid` or spawn detached children escape the group anyway.
 * @param startedAt epoch milliseconds taken before the dead child was spawned
 * @returns the orphan PIDs that were targeted
 */
export function killOrphanedChildrenSync(deadPid: number, startedAt?: number): number[] {
  if (process.platform !== 'win32' || !deadPid || deadPid <= 0) {
    return []
  }
  const exitedAt = Date.now()
  const table = readWindowsProcessTable()
  if (!table) {
    return []
  }
  // A live row for `deadPid` is a new process that reused the PID. Bound by time, and exclude
  // anything created at or after that replacement, which belongs to it rather than the dead child.
  const replacementCreated = table.created.get(deadPid)
  const orphans = (table.children.get(deadPid) ?? []).filter((pid) => {
    const created = table.created.get(pid)
    return (
      pid !== process.pid &&
      createdWithin(created, startedAt, exitedAt) &&
      (replacementCreated === undefined || created === undefined || created < replacementCreated)
    )
  })
  const targets: number[] = []
  for (const orphan of orphans) {
    targets.push(...walkWindowsTree(table, orphan).reverse(), orphan)
  }
  taskkillSync(targets)
  return orphans
}

/**
 * Terminate `pid` and its descendants. On Windows uses `taskkill /F` on the tree found by
 * {@link listDescendantPids}. On POSIX walks the process tree and signals leaves before parents.
 */
export function treeKillSync(pid: number, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (!pid || pid <= 0) {
    return
  }
  if (process.platform === 'win32') {
    taskkillSync([...listDescendantPids(pid).reverse(), pid])
    return
  }
  const descendants = listDescendantPids(pid)
  for (const child of descendants.reverse()) {
    try {
      process.kill(child, signal)
    } catch {
      // Already gone.
    }
  }
  try {
    process.kill(pid, signal)
  } catch {
    // Already gone.
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/**
 * Read process start times (epoch milliseconds) for `pids`. Missing PIDs are gone; `NaN` means the
 * start time could not be parsed. Returns `undefined` when the process table cannot be read.
 */
function readStartTimes(pids: number[]): Map<number, number> | undefined {
  if (process.platform === 'win32') {
    const table = readWindowsProcessTable()
    if (!table) {
      return
    }
    const alive = new Set<number>()
    for (const list of table.children.values()) {
      for (const pid of list) {
        alive.add(pid)
      }
    }
    const result = new Map<number, number>()
    for (const pid of pids) {
      if (alive.has(pid)) {
        result.set(pid, table.created.get(pid) ?? Number.NaN)
      }
    }
    return result
  }
  let out: string
  try {
    out = execFileSync('ps', ['-o', 'pid=,lstart=', '-p', pids.join(',')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // `lstart` follows LC_TIME; pin the format Date.parse understands.
      env: { ...process.env, LC_ALL: 'C' },
    })
  } catch (error) {
    // ps exits 1 silently when none of the PIDs exist, still printing the (empty) listing. Any
    // other failure (e.g. busybox rejecting `lstart`, which also exits 1 but complains on stderr)
    // means the start times are unknown: return `undefined` so the caller keeps every PID.
    const { status, stdout, stderr } = error as {
      status?: unknown
      stdout?: unknown
      stderr?: unknown
    }
    if (
      status !== 1 ||
      typeof stdout !== 'string' ||
      (typeof stderr === 'string' && stderr.trim())
    ) {
      return
    }
    out = stdout
  }
  const result = new Map<number, number>()
  for (const line of out.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line)
    if (match) {
      result.set(Number(match[1]), Date.parse(match[2]!))
    }
  }
  return result
}

/**
 * Best-effort SIGKILL of leftover PIDs after the direct child has exited.
 * Waits briefly so callers observing liveness do not race kernel reaping.
 * @param snapshotAt epoch milliseconds right after `pids` were listed. When given, PIDs that are
 * gone or now belong to a process started after the snapshot (PID reuse) are skipped.
 */
export function killPidsSync(pids: number[], snapshotAt?: number): void {
  let targets = pids.filter((pid) => pid > 0)
  if (snapshotAt !== undefined && targets.length) {
    const started = readStartTimes(targets)
    if (started) {
      targets = targets.filter((pid) => {
        const time = started.get(pid)
        // Keep PIDs whose start time could not be parsed; nothing to compare against.
        // POSIX `lstart` has 1-second precision, so a PID reused within the snapshot's second
        // is still targeted; erring towards cleanup there is accepted.
        return time !== undefined && (Number.isNaN(time) || time <= snapshotAt)
      })
    }
  }
  if (process.platform === 'win32') {
    taskkillSync(targets)
  } else {
    for (const pid of targets) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }
  const deadline = Date.now() + 500
  const park = new Int32Array(new SharedArrayBuffer(4))
  while (Date.now() < deadline && targets.some(isPidAlive)) {
    Atomics.wait(park, 0, 0, 10)
  }
}
