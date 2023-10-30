import path from 'path'
import { app, BrowserWindow } from 'electron'

const windows: BrowserWindow[] = []

function createWindow() {
  // Renderer 1
  const win = new BrowserWindow()
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(path.posix.join(process.env.VITE_DEV_SERVER_URL, 'html/index.html'))
  } else {
    win.loadFile(path.join(__dirname, '../dist/html/index.html'))
  }
  windows.push(win)

  // Renderer 2
  const nodeTrue = new BrowserWindow({
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
    width: 700,
    height: 500,
  })
  if (process.env.VITE_DEV_SERVER_URL) {
    nodeTrue.loadURL('http://localhost:5174/html/node-true.html')
  } else {
    nodeTrue.loadFile(path.join(__dirname, '../dist/html/node-true.html'))
  }
  windows.push(nodeTrue)

  // Renderer 3
  const nodeFalse = new BrowserWindow({
    width: 600,
    height: 400,
  })
  if (process.env.VITE_DEV_SERVER_URL) {
    nodeFalse.loadURL('http://localhost:5175/html/node-false.html')
  } else {
    nodeFalse.loadFile(path.join(__dirname, '../dist/html/node-false.html'))
  }
  windows.push(nodeFalse)
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  windows.length = 0
})
