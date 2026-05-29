import { join } from 'node:path'

import { app, BrowserWindow } from 'electron'
import { version } from 'typescript'

console.log(version, import.meta.env.MODE)

process.on('message', (message) => {
  if (message !== 'electron-vite&type=hot-reload') {
    return
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.reload()
  }
})

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    title: `Simple playground - pid ${process.pid}`,
    webPreferences: {
      contextIsolation: true,
      preload: join(__dirname, 'preload.mjs'),
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL)
    return
  }

  void window.loadFile(join(__dirname, '../dist/index.html'))
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
