process.on('SIGTERM', () => process.send('stopping'))
process.on('SIGINT', () => {})
setInterval(() => {}, 1000)
process.send('ready')
