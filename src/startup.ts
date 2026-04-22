import type { StdioOptions, SpawnOptions } from 'node:child_process'
import path from 'node:path'

import { treeKillSync } from './utils'

export interface ElectronOnstartArgs {
  /**
   * Electron App startup function.
   * It will mount the Electron App child-process to `process.electronApp`.
   * @param argv default value `['.', '--no-sandbox']`
   * @param options options for `child_process.spawn`
   * @param customElectronPkg custom electron package name (default: 'electron')
   */
  startup: (
    argv?: string[],
    options?: import('node:child_process').SpawnOptions,
    customElectronPkg?: string,
  ) => Promise<void>
  /** Reload Electron-Renderer */
  reload: () => void
}

export type ElectronOnstart = (args: ElectronOnstartArgs) => void | Promise<void>

interface StartupFn {
  (argv?: string[], options?: SpawnOptions, customElectronPkg?: string): Promise<void>
  send: (message: string) => void
  hookedProcessExit: boolean
  exit: () => Promise<void>
}

/**
 * Electron App startup function.
 * It will mount the Electron App child-process to `process.electronApp`.
 * @param argv default value `['.', '--no-sandbox']`
 * @param options options for `child_process.spawn`
 * @param customElectronPkg custom electron package name (default: 'electron')
 */
export const startup: StartupFn = async (
  argv = ['.', '--no-sandbox'],
  options?: SpawnOptions,
  customElectronPkg?: string,
) => {
  const { spawn } = await import('node:child_process')
  const { createRequire } = await import('node:module')
  const electronPackage = customElectronPkg ?? 'electron'
  const baseDir = typeof options?.cwd === 'string' ? options.cwd : process.cwd()
  const roots = new Set<string>([
    baseDir,
    process.cwd(),
    ...(process.env.INIT_CWD ? [process.env.INIT_CWD] : []),
  ])
  const electronArgv = [...argv]

  if (electronArgv[0] === '.') {
    electronArgv[0] = baseDir
  }

  let electron: any
  let resolutionError: unknown

  for (const root of roots) {
    try {
      const requireFromRoot = createRequire(path.join(root, 'package.json'))
      electron = requireFromRoot(electronPackage)
      break
    } catch (error) {
      resolutionError = error
    }
  }

  if (!electron) {
    try {
      electron = await import(electronPackage)
    } catch (error) {
      resolutionError = error
    }
  }

  if (!electron) {
    throw new Error(
      `Unable to resolve "${electronPackage}". Install it in the app project or pass startup(..., ..., customElectronPkg).`,
      { cause: resolutionError as Error },
    )
  }

  const electronPath = electron.default ?? electron

  await startup.exit()

  const stdio: StdioOptions =
    process.platform === 'linux'
      ? ['inherit', 'inherit', 'inherit', 'ignore', 'ipc']
      : ['inherit', 'inherit', 'inherit', 'ipc']

  process.electronApp = spawn(electronPath, electronArgv, {
    ...options,
    cwd: baseDir,
    stdio,
  })

  process.electronApp.once('exit', process.exit)

  if (!startup.hookedProcessExit) {
    startup.hookedProcessExit = true
    process.once('exit', startup.exit)
  }
}

startup.send = (message: string) => {
  if (process.electronApp) {
    process.electronApp.send?.(message)
  }
}

startup.hookedProcessExit = false
startup.exit = async () => {
  if (process.electronApp) {
    await new Promise((resolve) => {
      process.electronApp.removeAllListeners()

      if (process.electronApp.exitCode !== null) {
        resolve(undefined)
        return
      }
      process.electronApp.once('exit', resolve)

      try {
        treeKillSync(process.electronApp.pid!)
      } catch {
        resolve(undefined)
      }
    })
  }
}
