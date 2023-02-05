import path from 'path'
import {
  app,
  BrowserWindow,
  ipcMain,
} from 'electron'

const windows: BrowserWindow[] = []

function switchURL(html = 'index.html') {
  const win = new BrowserWindow({
    title: `BrowserWindow(${html}): ${windows.length + 1}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(path.posix.join(process.env.VITE_DEV_SERVER_URL, 'html', html))
  } else {
    win.loadFile(path.join(__dirname, `../dist/html/${html}`))
  }
  windows.push(win)
}

ipcMain.handle('to-window', (_ev, html: string) => {
  switchURL(html)
})

app.whenReady().then(() => {
  switchURL()
})

app.on('window-all-closed', () => {
  windows.length = 0
})
