process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

import path from 'path'
import { app, BrowserWindow } from 'electron'

let win: BrowserWindow | null = null

app.whenReady().then(() => {
  win = new BrowserWindow({
    webPreferences: {
      nodeIntegrationInWorker: true,
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
    },
  })

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  }
})
