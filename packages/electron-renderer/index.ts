import type { Plugin } from 'vite'
import buildConfig from './plugins/build-config'
import polyfillExports from './plugins/polyfill-exports'
import {
  type Options,
  default as useNodeJs,
} from './plugins/use-node.js'

export default function renderer(options: Options = {}): Plugin[] {
  return [
    buildConfig(),
    polyfillExports(),
    useNodeJs(options),
  ]
}
