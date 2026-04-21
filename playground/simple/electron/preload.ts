import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('playgroundApi', {
  getState: () => ({
    electronVersion: process.versions.electron,
    loadedAt: new Date().toISOString(),
    pid: process.pid,
  }),
  ping: () => `pong from preload ${process.pid}`,
})
