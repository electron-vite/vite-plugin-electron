import path from 'path'
import type { Plugin } from 'vite'

// https://github.com/vitejs/vite/blob/main/packages/vite/src/node/constants.ts#L84-L124
const KNOWN_ASSET_TYPES = [
  // images
  'png',
  'jpe?g',
  'jfif',
  'pjpeg',
  'pjp',
  'gif',
  'svg',
  'ico',
  'webp',
  'avif',

  // media
  'mp4',
  'webm',
  'ogg',
  'mp3',
  'wav',
  'flac',
  'aac',

  // fonts
  'woff2?',
  'eot',
  'ttf',
  'otf',

  // other
  'webmanifest',
  'pdf',
  'txt'
]

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

      // `Uncaught TypeError: Failed to construct 'URL': Invalid URL` #44
      // `vite@3.0.6` fixed this BUG 🐞
      // https://github.com/vitejs/vite/pull/9381/commits/8f2065efcb6ba664f7dce6f3c7666b29e2c56027#diff-aa53520bfd53e6c24220c44494457cc66370fd2bee513c15f9be7eb537a363e7L874
      if (!config.experimental) config.experimental = {
        renderBuiltUrl(filename, type) {
          if (
            KNOWN_ASSET_TYPES.includes(path.extname(filename).slice(1)) &&
            type.hostType === 'js'
          ) {
            // Avoid Vite relative-path assets handling
            // https://github.com/vitejs/vite/blob/89dd31cfe228caee358f4032b31fdf943599c842/packages/vite/src/node/build.ts#L850-L862
            return { runtime: JSON.stringify(filename) }
          }
          // TODO: replace `config.build.assetsDir` for chunk js
          // TODO: replace `config.build.assetsDir` for split css
        },
      }
    },
  }
}
