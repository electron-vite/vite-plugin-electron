import './style.css'

type ShutdownState = {
  scenario: string
  pid: number
  helperPid: number | null
  events: string[]
}

type ElectronBridge = {
  ipcRenderer: {
    invoke: (channel: string) => Promise<ShutdownState | void>
  }
}

const { ipcRenderer } = (window as Window & { require: (id: string) => ElectronBridge }).require(
  'electron',
)

const scenarioElement = document.querySelector<HTMLElement>('#scenario')
const pidElement = document.querySelector<HTMLElement>('#pid')
const helperPidElement = document.querySelector<HTMLElement>('#helper-pid')
const eventsElement = document.querySelector<HTMLElement>('#events')
const quitButton = document.querySelector<HTMLButtonElement>('#quit')
const exitButton = document.querySelector<HTMLButtonElement>('#exit')
const ignoreButton = document.querySelector<HTMLButtonElement>('#ignore')
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')

const renderState = (state: ShutdownState) => {
  if (scenarioElement) {
    scenarioElement.textContent = state.scenario
  }
  if (pidElement) {
    pidElement.textContent = String(state.pid)
  }
  if (helperPidElement) {
    helperPidElement.textContent = state.helperPid === null ? 'none' : String(state.helperPid)
  }
  if (eventsElement) {
    eventsElement.textContent = state.events.join('\n') || 'No events yet'
  }
}

const refreshState = async () => {
  const state = await ipcRenderer.invoke('shutdown:state')
  if (state) {
    renderState(state)
  }
}

quitButton?.addEventListener('click', () => {
  void ipcRenderer.invoke('shutdown:quit')
})
exitButton?.addEventListener('click', () => {
  void ipcRenderer.invoke('shutdown:exit')
})
ignoreButton?.addEventListener('click', () => {
  void ipcRenderer.invoke('shutdown:ignore-signals').then((state) => {
    if (state) {
      renderState(state)
    }
  })
})
refreshButton?.addEventListener('click', () => {
  void refreshState()
})

void refreshState()
setInterval(() => {
  void refreshState()
}, 1000)
