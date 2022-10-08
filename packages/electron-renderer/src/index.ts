import type { Plugin } from 'vite'
import buildConfig from './build-config'
import polyfillExports from './polyfill-exports'
import {
  type UseNodeJsOptions,
  default as useNodeJs,
} from './use-node.js'

export { default as worker } from './worker'

export default function renderer(
  options: Omit<UseNodeJsOptions, 'nodeIntegrationInWorker'> = {}
): Plugin[] {
  return [
    buildConfig(),
    polyfillExports(),
    ...useNodeJs(options),
  ]
}
