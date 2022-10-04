import { defineConfig } from 'vite'
import { builtinModules } from 'module'
import pkg from './package.json'

export default defineConfig({
  build: {
    minify: false,
    emptyOutDir: false,
    outDir: '',
    lib: {
      entry: 'src/index.ts',
      formats: ['cjs', 'es'],
      fileName: format => format === 'cjs' ? '[name].cjs' : '[name].js',
    },
    rollupOptions: {
      external: [
        'electron',
        'esbuild',
        'vite',
        ...builtinModules,
        ...builtinModules.map(m => `node:${m}`),
        ...Object.keys(pkg.dependencies),
        /vite-plugin-electron-renderer/,
      ],
    },
  },
})
