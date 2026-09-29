const { spawn } = require('node:child_process')
const path = require('node:path')

process.on('message', (message) => {
  if (message !== 'start') return

  const descendant = spawn(process.execPath, [path.join(__dirname, 'descendant.cjs')], {
    // Keep the direct child's custom fd 4 pipe open after the direct child exits.
    stdio: ['ignore', 'pipe', 'ignore', 'ignore', 4],
    // Windows may end a descendant with its parent unless the fixture isolates it.
    // This is test setup only; the plugin never manages process groups.
    detached: process.platform === 'win32',
  })
  descendant.stdout.once('data', (message) => {
    if (message.toString().includes('ready')) process.send?.({ descendantPid: descendant.pid })
  })
})

// A cooperative Electron main process: it exits when the plugin signals it.
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
