import type { PluginOption, Plugin } from 'vite'
import buildConfig from './build-config'
import cjsShim from './cjs-shim'
import {
  type UseNodeJsOptions,
  default as useNodeJs,
} from './use-node.js'

export default function renderer(
  options: Omit<UseNodeJsOptions, 'nodeIntegrationInWorker'> = {}
): PluginOption {
  return [
    buildConfig(),
    options.nodeIntegration && cjsShim(),
    useNodeJs(options),
  ]
}

export function worker(
  options: Omit<UseNodeJsOptions, 'nodeIntegration'> = {}
): Plugin[] {
  // TODO: Tree-shake after worker build
  return useNodeJs(options)
    .map(plugin => Object.assign(plugin, { api: { isWorker: true } }))
}
