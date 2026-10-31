// Stand-in for Electron. `slow` takes a moment to shut down; `stubborn` ignores termination signals.
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
