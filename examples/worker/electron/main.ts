process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

import { app, BrowserWindow } from 'electron'
import path from 'path'
import { Worker } from 'worker_threads'

let win: BrowserWindow

app.whenReady().then(() => {
  win = new BrowserWindow({
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
    }
  })
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  }

  const worker = new Worker(path.join(__dirname, './worker.js'))
  worker.on('message', value => {
    console.log('[worker message]:', value)
  })
})
