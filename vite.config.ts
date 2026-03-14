import { builtinModules } from 'node:module'
import { defineConfig } from 'vite-plus'

const external = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((moduleId) => `node:${moduleId}`),
]

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  fmt: {
    tabWidth: 2,
    useTabs: false,
    semi: false,
    singleQuote: true,
    printWidth: 80,
    sortPackageJson: true,
  },
  pack: [
    {
      entry: {
        index: 'src/index.ts',
        plugin: 'src/plugin.ts',
        simple: 'src/simple.ts',
      },
      outDir: 'dist',
      format: ['cjs'],
      dts: false,
      platform: 'node',
      fixedExtension: false,
      deps: {
        neverBundle: external,
        skipNodeModulesBundle: true,
      },
      outputOptions: {
        exports: 'named',
      },
    },
    {
      entry: {
        index: 'src/index.ts',
        plugin: 'src/plugin.ts',
        simple: 'src/simple.ts',
      },
      outDir: 'dist',
      format: ['esm'],
      dts: true,
      clean: false,
      platform: 'node',
      fixedExtension: false,
      deps: {
        neverBundle: external,
        skipNodeModulesBundle: true,
      },
    },
  ],
})
