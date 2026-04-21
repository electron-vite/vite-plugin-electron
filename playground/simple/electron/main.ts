import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow } from 'electron'

const currentDir = dirname(fileURLToPath(import.meta.url))

process.on('message', (message) => {
  if (message !== 'electron-vite&type=hot-reload') {
    return
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.reload()
  }
})

const createWindow = () => {
  const preloadPath = fileURLToPath(new URL('./preload.mjs', import.meta.url))

  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    title: `Simple playground - pid ${process.pid}`,
    webPreferences: {
      contextIsolation: true,
      preload: preloadPath,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL)
    return
  }

  void window.loadFile(join(currentDir, '../dist/index.html'))
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
