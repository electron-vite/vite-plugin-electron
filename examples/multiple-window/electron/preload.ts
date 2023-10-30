import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld(
  'electron',
  {
    toWindow(html: string) {
      ipcRenderer.invoke('to-window', html)
    },
  },
)
