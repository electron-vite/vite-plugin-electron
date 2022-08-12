import type { Plugin } from 'vite'

export default function buildConfig(): Plugin {
  return {
    name: 'vite-plugin-electron-renderer:build-config',
    apply: 'build',
    config(config) {
      // make sure that Electron can be loaded into the local file using `loadFile` after packaging
      if (config.base === undefined) config.base = './'

      if (config.build === undefined) config.build = {}

      // TODO: init `config.build.target`
      // https://github.com/vitejs/vite/pull/8843

      // ensure that static resources are loaded normally
      // TODO: Automatic splicing `build.assetsDir`
      if (config.build.assetsDir === undefined) config.build.assetsDir = ''

      // https://github.com/electron-vite/electron-vite-vue/issues/107
      if (config.build.cssCodeSplit === undefined) config.build.cssCodeSplit = false

      // prevent accidental clearing of `dist/electron/main`, `dist/electron/preload`
      if (config.build.emptyOutDir === undefined) config.build.emptyOutDir = false
    },
  }
}
