import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    legacy: 'src/legacy.ts',
    plugin: 'src/plugin.ts',
  },
  outputOptions: {
    exports: 'named',
  },
  dts: { oxc: true },
  format: ['cjs', 'esm'],
  deps: {
    neverBundle: ['vite'],
  },
  exports: {
    customExports(exports) {
      exports['./electron-env'] = {
        types: './electron-env.d.ts',
      }
      return exports
    },
  },
})
