// Simulate a subprocess that does not shut down with its parent.
process.on('SIGTERM', () => {})
process.on('SIGINT', () => {})
setInterval(() => {}, 1_000)
process.stdout.write('ready\n')
