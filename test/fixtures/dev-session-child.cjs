process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
setInterval(() => {}, 1000)
process.send('ready')
