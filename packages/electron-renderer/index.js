const buildConfig = require('./plugins/build-config');
const polyfillExports = require('./plugins/polyfill-exports');
const useNodeJs = require('./plugins/use-node.js');

/**
 * @type {import('.').VitePluginElectronRenderer}
 */
module.exports = function renderer(options = {}) {
  return [
    buildConfig(),
    polyfillExports(),
    useNodeJs(options),
  ];
};
