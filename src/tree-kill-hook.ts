import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Holds the user's original `NODE_OPTIONS` so the hook can restore it for Electron's own children. */
export const TREE_KILL_NODE_OPTIONS_KEY = '__VITE_PLUGIN_ELECTRON_NODE_OPTIONS'

interface ProcessRow {
  pid: number
  ppid: number
  /** Creation time in epoch milliseconds (Windows only). */
  created?: number
  args: string
}

/**
 * Preloaded into the Electron main process with `NODE_OPTIONS=--require`.
 *
 * On `process` `exit` (reached by `app.quit()`, `app.exit()` and `process.exit()`), it synchronously
 * kills every process the app started, excluding Chromium's own helpers (`--type=...`). Electron on
 * Windows otherwise stays alive after quitting while such a child is still running.
 *
 * Serialized with `Function.prototype.toString()` and run inside Electron, so it must stay
 * self-contained: no outer variables or imports (pass them as arguments), and no syntax the build
 * may lower into helpers (`?.`, `??`, object spread, classes). `require` is passed in by the
 * generated call because bundlers rewrite `require()` calls in ESM output. `isWindows` is fixed
 * when the source is generated: the plugin and Electron run on the same machine.
 */
function treeKillHook(key: string, isWindows: boolean, nodeRequire: NodeJS.Require): void {
  if (key in process.env) {
    // Do not leak the hook into processes the app spawns.
    const original = process.env[key]
    delete process.env[key]
    if (original) {
      process.env.NODE_OPTIONS = original
    } else {
      delete process.env.NODE_OPTIONS
    }
  }
  if ((process as { type?: string }).type !== 'browser') {
    return
  }

  const { execFileSync } = nodeRequire('node:child_process') as typeof import('node:child_process')

  function readProcessTable(): ProcessRow[] {
    const options: import('node:child_process').ExecFileSyncOptionsWithStringEncoding = {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }
    const out = isWindows
      ? execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "Get-CimInstance Win32_Process | ForEach-Object { $c = if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { '' }; '' + $_.ProcessId + [char]9 + $_.ParentProcessId + [char]9 + $c + [char]9 + $_.CommandLine }",
          ],
          options,
        )
      : execFileSync('ps', ['-A', '-o', 'pid=,ppid=,args='], options)
    const pattern = isWindows ? /^(\d+)\t(\d+)(?:\t(\d*))?(?:\t(.*))?$/ : /^(\d+)\s+(\d+)()\s*(.*)$/
    const rows: ProcessRow[] = []
    for (const line of out.split(/\r?\n/)) {
      const match = pattern.exec(line.trim())
      if (match) {
        rows.push({
          pid: Number(match[1]),
          ppid: Number(match[2]),
          created: match[3] ? Number(match[3]) : undefined,
          args: match[4] || '',
        })
      }
    }
    return rows
  }

  function killAppDescendants(): void {
    const byParent = new Map<number, ProcessRow[]>()
    let self: ProcessRow | undefined
    for (const row of readProcessTable()) {
      if (row.pid === process.pid) {
        self = row
      }
      if (row.pid === row.ppid) {
        continue
      }
      const list = byParent.get(row.ppid)
      if (list) {
        list.push(row)
      } else {
        byParent.set(row.ppid, [row])
      }
    }
    // Windows keeps a dead parent's id in ParentProcessId and reuses PIDs: a row created before
    // its parent names an earlier owner of that PID, not this process tree.
    const isChildOf = (row: ProcessRow, parent: ProcessRow | undefined): boolean =>
      !parent ||
      parent.created === undefined ||
      row.created === undefined ||
      row.created >= parent.created
    // Chromium helpers (renderer, gpu, utility, zygote, crashpad) carry --type= and exit with Electron.
    const roots = (byParent.get(process.pid) || []).filter(
      (row) => !/(^|\s)--type=/.test(row.args) && isChildOf(row, self),
    )
    const targets: number[] = []
    const seen = new Set<number>([process.pid])
    const visit = (row: ProcessRow): void => {
      if (seen.has(row.pid)) {
        return
      }
      seen.add(row.pid)
      for (const child of byParent.get(row.pid) || []) {
        if (isChildOf(child, row)) {
          visit(child)
        }
      }
      targets.push(row.pid) // children before parents
    }
    roots.forEach(visit)
    if (!targets.length) {
      return
    }
    if (isWindows) {
      const args = ['/F']
      for (const pid of targets) {
        args.push('/PID', String(pid))
      }
      try {
        execFileSync('taskkill', args, { stdio: 'ignore', windowsHide: true })
      } catch {
        // Some targets may already be gone.
      }
      return
    }
    for (const pid of targets) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }

  process.once('exit', () => {
    try {
      killAppDescendants()
    } catch {
      // Best effort: never change how Electron exits.
    }
  })
}

/** CommonJS source of the hook file preloaded into Electron. */
export const TREE_KILL_HOOK_SOURCE: string = `'use strict';\n(${treeKillHook})(${JSON.stringify(
  TREE_KILL_NODE_OPTIONS_KEY,
)}, ${process.platform === 'win32'}, require);\n`

function readFileIfExists(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Write the hook to `<cacheDir>/vite-plugin-electron/` and return its path. Pass Vite's resolved
 * `config.cacheDir` (by default `node_modules/.vite` of the project): it belongs to the project,
 * unlike a shared temp dir where another local user could plant a file that would then be
 * preloaded into Electron. An existing file is only reused when its content matches the current
 * hook source; otherwise it is replaced.
 */
export function ensureTreeKillHook(cacheDir: string): string {
  const hash = createHash('sha256').update(TREE_KILL_HOOK_SOURCE).digest('hex').slice(0, 12)
  const file = path.join(cacheDir, 'vite-plugin-electron', `tree-kill-hook-${hash}.cjs`)
  if (readFileIfExists(file) === TREE_KILL_HOOK_SOURCE) {
    return file
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // Write then rename so a concurrent Electron launch never reads a partial file.
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, TREE_KILL_HOOK_SOURCE)
  try {
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    // Another process may have won the race (and may hold the file open on Windows).
    if (readFileIfExists(file) !== TREE_KILL_HOOK_SOURCE) {
      throw error
    }
  }
  return file
}

type Env = Record<string, string | undefined>

/**
 * Return a copy of `env` whose `NODE_OPTIONS` preloads the tree-kill hook.
 * The original `NODE_OPTIONS` is kept under {@link TREE_KILL_NODE_OPTIONS_KEY} for the hook to restore.
 */
export function withTreeKillHook(env: Env, file: string): NodeJS.ProcessEnv {
  const original = env.NODE_OPTIONS ?? ''
  // NODE_OPTIONS treats backslashes inside double quotes as escapes; JSON escaping matches that.
  const require = `--require ${JSON.stringify(file)}`
  const result: Env = {
    ...env,
    NODE_OPTIONS: original ? `${original} ${require}` : require,
    [TREE_KILL_NODE_OPTIONS_KEY]: original,
  }
  // The repo's ProcessEnv augmentation marks app keys as required; spawn only needs a string map.
  return result as NodeJS.ProcessEnv
}
