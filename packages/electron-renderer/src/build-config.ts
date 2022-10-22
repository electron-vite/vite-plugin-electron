import type { Plugin } from 'vite'

export default function buildConfig(): Plugin {
  return {
    name: 'vite-plugin-electron-renderer:build-config',
    apply: 'build',
    config(config) {
      // make sure that Electron can be loaded into the local file using `loadFile` after packaging
      config.base ??= './'

      config.build ??= {}

      // TODO: init `config.build.target`
      // https://github.com/vitejs/vite/pull/8843

      // https://github.com/electron-vite/electron-vite-vue/issues/107
      config.build.cssCodeSplit ??= false
    },
  }
}
