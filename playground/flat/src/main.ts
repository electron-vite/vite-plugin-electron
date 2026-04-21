import './style.css'

type MainState = {
  mode: 'flat'
  pid: number
  startedAt: string
}

type ElectronBridge = {
  ipcRenderer: {
    invoke: (channel: string) => Promise<MainState>
  }
}

const { ipcRenderer } = (window as Window & { require: (id: string) => ElectronBridge }).require(
  'electron',
)
console.log(process.versions)
const pidElement = document.querySelector<HTMLElement>('#pid')
const startedAtElement = document.querySelector<HTMLElement>('#started-at')
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')

const renderState = (state: MainState) => {
  if (pidElement) {
    pidElement.textContent = String(state.pid)
  }

  if (startedAtElement) {
    startedAtElement.textContent = state.startedAt
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
