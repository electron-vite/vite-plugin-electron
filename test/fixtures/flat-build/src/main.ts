import { rendererLoadedStatus } from 'virtual:flat-build/renderer-status'

document.querySelector('#app')!.textContent = rendererLoadedStatus
