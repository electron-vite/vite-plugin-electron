import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import { app, BrowserWindow, ipcMain } from 'electron'

declare const __PLAYGROUND_MULTI_ENV_MAIN_LABEL__: string
declare const __PLAYGROUND_MULTI_ENV_MAIN_NAME__: string

const startedAt = new Date().toISOString()

process.on('message', (message) => {
  if (message !== 'electron-vite&type=hot-reload') {
    return
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.reload()
  }
})

ipcMain.handle('playground:multi-env-state', () => ({
  electronVersion: process.versions.electron,
  mainEnvironment: __PLAYGROUND_MULTI_ENV_MAIN_NAME__,
  mainPid: process.pid,
  mainStartedAt: startedAt,
  mainStatus: __PLAYGROUND_MULTI_ENV_MAIN_LABEL__,
}))
const __dirname = dirname(fileURLToPath(import.meta.url))
const createWindow = () => {
  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    title: `Multi-env playground - pid ${process.pid}`,
    webPreferences: {
      contextIsolation: true,
      preload: join(__dirname, 'preload.mjs'),
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void window.loadFile(join(__dirname, '../dist/index.html'))
  }
  const worker = new Worker(join(__dirname, './worker.js'))
  worker.on('message', (value) => {
    console.log('[worker message]:', value)
  })
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
