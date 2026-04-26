import { contextBridge, ipcRenderer } from 'electron'

declare const __PLAYGROUND_MULTI_ENV_PRELOAD_LABEL__: string
declare const __PLAYGROUND_MULTI_ENV_PRELOAD_NAME__: string

const loadedAt = new Date().toISOString()

contextBridge.exposeInMainWorld('multiEnvApi', {
  async getState() {
    const mainState = await ipcRenderer.invoke('playground:multi-env-state')

    return {
      ...mainState,
      preloadEnvironment: __PLAYGROUND_MULTI_ENV_PRELOAD_NAME__,
      preloadLoadedAt: loadedAt,
      preloadPid: process.pid,
      preloadStatus: __PLAYGROUND_MULTI_ENV_PRELOAD_LABEL__,
    }
  },
  ping() {
    return `pong from ${__PLAYGROUND_MULTI_ENV_PRELOAD_LABEL__} (${process.pid})`
  },
})
