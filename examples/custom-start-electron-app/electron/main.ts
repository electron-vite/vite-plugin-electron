import path from 'path'
import { app, BrowserWindow } from 'electron'

let win: BrowserWindow

app.whenReady().then(() => {
  win = new BrowserWindow()
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  }
})
