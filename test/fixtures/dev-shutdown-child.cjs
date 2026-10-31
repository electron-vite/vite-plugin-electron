// Stand-in for Electron.
// - `slow` takes a moment to shut down on SIGINT/SIGTERM, then writes the marker file.
// - `stubborn` ignores termination signals.
// - `quit` exits by itself with code 3, like a user quitting the app.
const fs = require('node:fs')

const [mode, marker] = process.argv.slice(2)

if (mode === 'stubborn') {
  process.on('SIGINT', () => {})
  process.on('SIGTERM', () => {})
} else {
  const stop = () =>
    setTimeout(() => {
      fs.writeFileSync(marker, 'done')
      process.exit(0)
    }, 300)
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

setInterval(() => {}, 1000)
process.send('ready')

if (mode === 'quit') {
  setTimeout(() => process.exit(3), 100)
}
