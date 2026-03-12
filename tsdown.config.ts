import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
    simple: 'src/simple.ts',
  },
  outputOptions: {
    exports: 'named'
  },
  dts: { oxc: true },
  format: ['cjs', 'esm'],
  external: [
    'vite'
  ],
  exports: {
    customExports(exports) {
      exports["./electron-env"] = {
        types: "./electron-env.d.ts"
      }
      return exports
    },
  }
})