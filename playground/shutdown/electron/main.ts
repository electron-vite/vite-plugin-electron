import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { app, BrowserWindow, ipcMain } from 'electron'

type ShutdownScenario = 'descendants' | 'natural-exit' | 'ignore-signals' | 'two-plugins'

type ShutdownState = {
  scenario: ShutdownScenario
  pid: number
  helperPid: number | null
  events: string[]
}

const scenario = (process.env.SHUTDOWN_SCENARIO ?? 'descendants') as ShutdownScenario
const events: string[] = []
let helperPid: number | null = null
let ignoreOsQuit = scenario === 'ignore-signals'

function logEvent(name: string): void {
  const line = `${new Date().toISOString()} ${name}`
  events.push(line)
  console.log(`[shutdown-playground] ${line}`)
}

function currentState(): ShutdownState {
  return {
    scenario,
    pid: process.pid,
    helperPid,
    events: [...events],
  }
}

process.on('SIGINT', () => logEvent('process received SIGINT'))
process.on('SIGTERM', () => logEvent('process received SIGTERM'))

app.on('before-quit', (event) => {
  logEvent('app before-quit')
  if (ignoreOsQuit) {
    event.preventDefault()
    logEvent('app before-quit prevented (ignore-signals)')
  }
})
app.on('will-quit', () => logEvent('app will-quit'))
app.on('quit', () => logEvent('app quit'))

if (scenario === 'ignore-signals') {
  process.on('SIGINT', () => logEvent('SIGINT swallowed'))
  process.on('SIGTERM', () => logEvent('SIGTERM swallowed'))
}

function spawnHelper(): void {
  const helper = spawn(process.execPath, [join(process.cwd(), 'electron/helper.cjs')], {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: process.platform === 'win32',
  })
  helperPid = helper.pid ?? null
  if (process.platform === 'win32') {
    helper.unref()
  }
  logEvent(`spawned helper pid=${helperPid}`)
}

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    title: `Shutdown playground - pid ${process.pid}`,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL)
    return
  }

  void window.loadFile(join(__dirname, '../dist/index.html'))
}

ipcMain.handle('shutdown:state', () => currentState())
ipcMain.handle('shutdown:quit', () => {
  ignoreOsQuit = false
  logEvent('renderer requested app.quit()')
  app.quit()
})
ipcMain.handle('shutdown:exit', () => {
  logEvent('renderer requested process.exit(0)')
  process.exit(0)
})
ipcMain.handle('shutdown:ignore-signals', () => {
  ignoreOsQuit = true
  process.on('SIGINT', () => logEvent('SIGINT swallowed'))
  process.on('SIGTERM', () => logEvent('SIGTERM swallowed'))
  logEvent('now ignoring SIGINT/SIGTERM and preventing before-quit')
  return currentState()
})

app.whenReady().then(() => {
  spawnHelper()
  if (process.env.SHUTDOWN_HEADLESS !== '1') {
    createWindow()
  }
  logEvent(`ready scenario=${scenario}`)
  if (scenario === 'natural-exit') {
    setTimeout(() => {
      logEvent('natural-exit timer calling app.quit()')
      app.quit()
    }, 1500)
  }
})

app.on('window-all-closed', () => {
  logEvent('window-all-closed')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
