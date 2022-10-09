import type { Plugin } from 'vite'
import {
  type UseNodeJsOptions,
  default as useNodeJs,
} from './use-node.js'

export default function worker(
  options: Omit<UseNodeJsOptions, 'nodeIntegration'> = {}
): Plugin[] {
  // TODO: Tree-shake after worker build
  return useNodeJs(options)
    .map(plugin => Object.assign(plugin, { api: { isWorker: true } }))
}
