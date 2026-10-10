process.on('SIGINT', () => {})
process.on('SIGTERM', () => {})
process.on('SIGHUP', () => {})

const beat = () => {
  process.stdout.write(`[shutdown-helper] still alive pid=${process.pid} ppid=${process.ppid}\n`)
}

beat()
setInterval(beat, 1000)
