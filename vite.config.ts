import { defineConfig } from 'vite'
import { builtinModules } from 'node:module'
import pkg from './package.json'

export default defineConfig({
  build: {
    minify: false,
    emptyOutDir: false,
    outDir: '',
    lib: {
      entry: 'src/index.ts',
      formats: ['cjs', 'es'],
      fileName: format => format === 'es' ? '[name].mjs' : '[name].js',
    },
    rollupOptions: {
      external: [
        'electron',
        'vite',
        ...builtinModules,
        ...builtinModules.map(m => `node:${m}`),
        ...Object.keys("dependencies" in pkg ? pkg.dependencies as object : {}),
      ],
      output: {
        exports: 'named',
      },
    },
  },
})
