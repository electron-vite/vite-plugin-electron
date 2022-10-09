import type { PluginOption } from 'vite'
import buildConfig from './build-config'
import cjsShim from './cjs-shim'
import {
  type UseNodeJsOptions,
  default as useNodeJs,
} from './use-node.js'

export { default as worker } from './worker'

export default function renderer(
  options: Omit<UseNodeJsOptions, 'nodeIntegrationInWorker'> = {}
): PluginOption {
  return [
    buildConfig(),
    options.nodeIntegration && cjsShim(),
    useNodeJs(options),
  ]
}
