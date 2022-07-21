import type { Plugin } from 'vite'
import buildConfig from './build-config'
import polyfillExports from './polyfill-exports'
import {
  type Options,
  default as useNodeJs,
} from './use-node.js'

export default function renderer(options: Options = {}): Plugin[] {
  return [
    buildConfig(),
    polyfillExports(),
    useNodeJs(options),
  ]
}
