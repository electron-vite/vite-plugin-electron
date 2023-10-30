import path from 'node:path'
import { defineConfig } from 'vite'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
  plugins: [
    renderer(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: path.join(__dirname, 'html/node-false.html'),
    },
  },
})
