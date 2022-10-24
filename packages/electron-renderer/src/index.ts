import type { PluginOption, Plugin } from 'vite'
import buildConfig from './build-config'
import cjsShim from './cjs-shim'
import {
  type UseNodeJsOptions,
  default as useNodeJs,
} from './use-node.js'
import {
  type DepOptimizationConfig,
  default as optimizer,
} from './optimizer'

export default function renderer(
  options: Omit<UseNodeJsOptions, 'nodeIntegrationInWorker'> & {
    /**
     * If the npm-package you are using is a Node.js package, then you need to Pre Bundling it.
     * @see https://vitejs.dev/guide/dep-pre-bundling.html
     */
    optimizeDeps?: DepOptimizationConfig
  } = {}
): PluginOption {
  return [
    buildConfig(),
    options.nodeIntegration && cjsShim(),
    useNodeJs(options),
    options.optimizeDeps && optimizer(options.optimizeDeps),
  ]
}

export function worker(
  options: Omit<UseNodeJsOptions, 'nodeIntegration'> = {}
): Plugin[] {
  // TODO: Tree-shake after worker build
  return useNodeJs(options)
    .map(plugin => Object.assign(plugin, { api: { isWorker: true } }))
}
