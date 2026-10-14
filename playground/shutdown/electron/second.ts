import { app } from 'electron'

console.log(`[shutdown-second] pid=${process.pid}`)

app.whenReady().then(() => {
  console.log(
    '[shutdown-second] ready; this process shares process.electronApp with the first plugin',
  )
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
