import { factorial } from './lib/util'
import { parentPort } from 'node:worker_threads'

parentPort?.on('message', mes => {
  const result = factorial(mes)
  parentPort?.postMessage(result)
})

