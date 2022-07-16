/**
 * @type {import('.').BuildConfig}
 */
module.exports = function buildConfig() {
  return {
    name: 'vite-plugin-electron-renderer:build-config',
    apply: 'build',
    config(config) {
      if (!config.build) config.build = {};

      // make sure that Electron can be loaded into the local file using `loadFile` after packaging
      if (config.base === undefined) config.base = './';

      if (config.build === undefined) config.build = {};

      // TODO: Init `config.build.target`

      // ensure that static resources are loaded normally
      // TODO: Automatic splicing `build.assetsDir`
      if (config.build.assetsDir === undefined) config.build.assetsDir = '';

      // https://github.com/electron-vite/electron-vite-vue/issues/107
      if (config.build.cssCodeSplit === undefined) config.build.cssCodeSplit = false;

      // prevent accidental clearing of `dist/electron/main`, `dist/electron/preload`
      if (config.build.emptyOutDir === undefined) config.build.emptyOutDir = false;
    },
  };
};
