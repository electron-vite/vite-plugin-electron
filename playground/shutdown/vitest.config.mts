import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.resolve(dir, '../..'),
  test: {
    include: ['playground/shutdown/scripts/reproduce.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    disableConsoleIntercept: true,
  },
})
