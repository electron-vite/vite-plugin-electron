import { parentPort } from 'node:worker_threads'

setTimeout(() => {
  parentPort?.postMessage(`worker_threads ${new Date().toLocaleTimeString()}`)
}, 999)
