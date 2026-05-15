import type { Plugin } from 'vite'

const ESM_SHIM_CODE = `
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
`

export function esmShim(): Plugin {
  return {
    name: 'vite-plugin-electron:esm-shim',
    // Run before the builtin plugin 'vite:resolve'
    enforce: 'pre',
    transform: {
      filter: { code: [/\b__dirname\b/, /\b__filename\b/] },
      handler(code) {
        return ESM_SHIM_CODE + code
      },
    },
  }
}
