import { join } from 'node:path'

import { app, BrowserWindow, ipcMain } from 'electron'
// @ts-expect-error virtual module
import { mainLoadedStatus } from 'virtual:playground-flat/main-status'

const currentDir = __dirname
declare const __FLAT_MAIN_STATUS__: string
declare const __FLAT_MAIN_ENV_STATUS__: string
declare const __FLAT_MAIN_TRANSFORM_STATUS__: string

ipcMain.handle('playground:main-state', () => ({
  mode: 'flat' as const,
  pid: process.pid,
  startedAt: new Date().toISOString(),
  status: __FLAT_MAIN_STATUS__,
  environmentStatus: __FLAT_MAIN_ENV_STATUS__,
  loadedStatus: mainLoadedStatus,
  transformStatus: __FLAT_MAIN_TRANSFORM_STATUS__,
}))

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    title: `Flat playground - pid ${process.pid}`,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL)
    window.webContents.openDevTools()
  } else {
    window.loadFile(join(currentDir, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
