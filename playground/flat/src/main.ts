import './style.css'

// @ts-expect-error virtual module
import { rendererLoadedStatus } from 'virtual:playground-flat/renderer-status'

type MainState = {
  mode: 'flat'
  pid: number
  startedAt: string
  status: string
  environmentStatus: string
  loadedStatus: string
  transformStatus: string
}

type ElectronBridge = {
  ipcRenderer: {
    invoke: (channel: string) => Promise<MainState>
  }
}

type PlaygroundWindow = Window & {
  __flatRendererStatus?: string
}

declare const __FLAT_RENDERER_STATUS__: string
declare const __FLAT_RENDERER_TRANSFORM_STATUS__: string

const { ipcRenderer } = (window as Window & { require: (id: string) => ElectronBridge }).require(
  'electron',
)
console.log(process.versions)
const pidElement = document.querySelector<HTMLElement>('#pid')
const startedAtElement = document.querySelector<HTMLElement>('#started-at')
const rendererStatusElement = document.querySelector<HTMLElement>('#renderer-status')
const rendererDefineStatusElement = document.querySelector<HTMLElement>('#renderer-define-status')
const rendererLoadedStatusElement = document.querySelector<HTMLElement>('#renderer-loaded-status')
const rendererTransformStatusElement = document.querySelector<HTMLElement>(
  '#renderer-transform-status',
)
const mainStatusElement = document.querySelector<HTMLElement>('#main-status')
const mainEnvironmentStatusElement = document.querySelector<HTMLElement>('#main-environment-status')
const mainLoadedStatusElement = document.querySelector<HTMLElement>('#main-loaded-status')
const mainTransformStatusElement = document.querySelector<HTMLElement>('#main-transform-status')
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')

const renderState = (state: MainState) => {
  if (pidElement) {
    pidElement.textContent = String(state.pid)
  }

  if (startedAtElement) {
    startedAtElement.textContent = state.startedAt
  }

  if (rendererStatusElement) {
    rendererStatusElement.textContent =
      (window as PlaygroundWindow).__flatRendererStatus ?? 'missing'
  }

  if (rendererDefineStatusElement) {
    rendererDefineStatusElement.textContent = __FLAT_RENDERER_STATUS__
  }

  if (rendererLoadedStatusElement) {
    rendererLoadedStatusElement.textContent = rendererLoadedStatus
  }

  if (rendererTransformStatusElement) {
    rendererTransformStatusElement.textContent = __FLAT_RENDERER_TRANSFORM_STATUS__
  }

  if (mainStatusElement) {
    mainStatusElement.textContent = state.status
  }

  if (mainEnvironmentStatusElement) {
    mainEnvironmentStatusElement.textContent = state.environmentStatus
  }

  if (mainLoadedStatusElement) {
    mainLoadedStatusElement.textContent = state.loadedStatus
  }

  if (mainTransformStatusElement) {
    mainTransformStatusElement.textContent = state.transformStatus
  }
}

const refreshState = async () => {
  const state = await ipcRenderer.invoke('playground:main-state')
  renderState(state)
}

refreshButton?.addEventListener('click', () => {
  void refreshState()
})

void refreshState()
