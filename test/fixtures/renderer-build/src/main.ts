import { ipcRenderer } from 'electron'

document.querySelector<HTMLElement>('#app')!.textContent = typeof ipcRenderer
