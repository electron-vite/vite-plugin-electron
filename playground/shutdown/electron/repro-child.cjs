const { spawn } = require('node:child_process')
const path = require('node:path')

const mode = process.argv[2] ?? 'descendants'
const helperPath = process.env.SHUTDOWN_HELPER ?? path.join(__dirname, 'helper.cjs')

function send(message) {
  process.send?.(message)
}

function stayAlive() {
  setInterval(() => {}, 1000)
}

function spawnHelper() {
  const helper = spawn(process.execPath, [helperPath], {
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true,
  })
  helper.unref()
  return helper.pid
}

function start() {
  if (mode === 'natural-exit') {
    send({ ready: true, pid: process.pid })
    setTimeout(() => process.exit(0), 200)
    return
  }
  if (mode === 'natural-exit-descendants') {
    // Like Electron app.quit()/process.exit(0) with a detached helper still running.
    send({ ready: true, pid: process.pid, helperPid: spawnHelper() })
    setTimeout(() => process.exit(0), 200)
    return
  }
  if (mode === 'stay') {
    process.on('SIGINT', () => process.exit(0))
    process.on('SIGTERM', () => process.exit(0))
    send({ ready: true, pid: process.pid })
    stayAlive()
    return
  }
  if (mode === 'ignore-signals') {
    process.on('SIGINT', () => {})
    process.on('SIGTERM', () => {})
    send({ ready: true, pid: process.pid, helperPid: spawnHelper() })
    stayAlive()
    return
  }
  process.on('SIGINT', () => process.exit(0))
  process.on('SIGTERM', () => process.exit(0))
  send({ ready: true, pid: process.pid, helperPid: spawnHelper() })
  stayAlive()
}

process.on('message', (message) => {
  if (message === 'start') {
    start()
  }
})
