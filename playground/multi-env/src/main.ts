import './style.css'

type PlaygroundState = {
  electronVersion: string
  mainEnvironment: string
  mainPid: number
  mainStartedAt: string
  mainStatus: string
  preloadEnvironment: string
  preloadLoadedAt: string
  preloadPid: number
  preloadStatus: string
}

type PlaygroundApi = {
  getState: () => Promise<PlaygroundState>
  ping: () => string
}

const api = (window as Window & { multiEnvApi?: PlaygroundApi }).multiEnvApi

if (!api) {
  throw new Error('multiEnvApi is not available. Check the preload script.')
}

const mainPidElement = document.querySelector<HTMLElement>('#main-pid')
const mainStartedAtElement = document.querySelector<HTMLElement>('#main-started-at')
const mainStatusElement = document.querySelector<HTMLElement>('#main-status')
const mainEnvironmentElement = document.querySelector<HTMLElement>('#main-environment')
const preloadPidElement = document.querySelector<HTMLElement>('#preload-pid')
const preloadLoadedAtElement = document.querySelector<HTMLElement>('#preload-loaded-at')
const preloadStatusElement = document.querySelector<HTMLElement>('#preload-status')
const preloadEnvironmentElement = document.querySelector<HTMLElement>('#preload-environment')
const electronVersionElement = document.querySelector<HTMLElement>('#electron-version')
const pingElement = document.querySelector<HTMLElement>('#ping')
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')

const renderState = async () => {
  const state = await api.getState()

  if (mainPidElement) {
    mainPidElement.textContent = String(state.mainPid)
  }

  if (mainStartedAtElement) {
    mainStartedAtElement.textContent = state.mainStartedAt
  }

  if (mainStatusElement) {
    mainStatusElement.textContent = state.mainStatus
  }

  if (mainEnvironmentElement) {
    mainEnvironmentElement.textContent = state.mainEnvironment
  }

  if (preloadPidElement) {
    preloadPidElement.textContent = String(state.preloadPid)
  }

  if (preloadLoadedAtElement) {
    preloadLoadedAtElement.textContent = state.preloadLoadedAt
  }

  if (preloadStatusElement) {
    preloadStatusElement.textContent = state.preloadStatus
  }

  if (preloadEnvironmentElement) {
    preloadEnvironmentElement.textContent = state.preloadEnvironment
  }

  if (electronVersionElement) {
    electronVersionElement.textContent = state.electronVersion
  }

  if (pingElement) {
    pingElement.textContent = api.ping()
  }
}

refreshButton?.addEventListener('click', () => {
  void renderState()
})

void renderState()
