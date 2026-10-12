process.on('SIGINT', () => {})
process.on('SIGTERM', () => {})
process.on('SIGHUP', () => {})
process.on('SIGPIPE', () => {})

const beat = () => {
  try {
    process.stdout.write(`[shutdown-helper] still alive pid=${process.pid} ppid=${process.ppid}\n`)
  } catch {
    // Parent pipes may already be gone (e.g. host SIGKILL).
  }
}

beat()
setInterval(beat, 1000)
