import './style.css'

type PlaygroundState = {
  electronVersion: string
  loadedAt: string
  pid: number
}

type PlaygroundApi = {
  getState: () => PlaygroundState
  ping: () => string
}

const api = (window as Window & { playgroundApi?: PlaygroundApi }).playgroundApi

if (!api) {
  throw new Error('playgroundApi is not available. Check the preload script.')
}

const pidElement = document.querySelector<HTMLElement>('#pid')
const loadedAtElement = document.querySelector<HTMLElement>('#loaded-at')
const electronVersionElement = document.querySelector<HTMLElement>('#electron-version')
const pingElement = document.querySelector<HTMLElement>('#ping')
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')

const renderState = () => {
  const state = api.getState()

  if (pidElement) {
    pidElement.textContent = String(state.pid)
  }

  if (loadedAtElement) {
    loadedAtElement.textContent = state.loadedAt
  }

  if (electronVersionElement) {
    electronVersionElement.textContent = state.electronVersion
  }

  if (pingElement) {
    pingElement.textContent = api.ping()
  }
}

refreshButton?.addEventListener('click', renderState)

renderState()
