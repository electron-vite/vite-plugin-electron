import type { Plugin } from 'vite'
import buildConfig from './build-config'
import polyfillExports from './polyfill-exports'
import {
  type UseNodeJsOptions,
  default as useNodeJs,
} from './use-node.js'

export interface Options extends UseNodeJsOptions { }

export default function renderer(options: Options = {}): Plugin[] {
  return [
    buildConfig(),
    polyfillExports(),
    useNodeJs(options),
  ]
}
