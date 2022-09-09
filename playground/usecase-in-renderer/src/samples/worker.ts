import { ipcRenderer } from 'electron'

ipcRenderer.send('test-1', Date.now())
