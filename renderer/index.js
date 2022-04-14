const path = require('path');
const { builtinModules } = require('module');
const optimizer = require('vite-plugin-optimizer');

/**
 * @type {import('.').VitePluginElectronRenderer}
 */
module.exports = function () {
  const name = 'vite-plugin-electron-renderer';
  const builtins = builtinModules.filter(e => !e.startsWith('_'));
  const plugin = optimizer(builtinModulesExport(builtins), { dir: `.${name}` },);

  plugin.name = `${name}:optimizer`;
  plugin.apply = 'serve';

  return [
    plugin,
    {
      name: `${name}:config-serve`,
      apply: 'serve',
      config(config) {
        // Vite ---- resolve.alias ----
        if (!config.resolve) config.resolve = {};
        if (!config.resolve.conditions) config.resolve.conditions = ['node'];
        if (!config.resolve.alias) config.resolve.alias = [];

        const electronjs = path.join(__dirname, 'modules/electron-renderer.js');
        if (Array.isArray(config.resolve.alias)) {
          config.resolve.alias.push({ find: 'electron', replacement: electronjs });
        } else {
          config.resolve.alias['electron'] = electronjs;
        }

        // Vite ---- optimizeDeps.exclude ----
        if (!config.optimizeDeps) config.optimizeDeps = {};
        if (!config.optimizeDeps.exclude) config.optimizeDeps.exclude = [];

        config.optimizeDeps.exclude.push('electron');
      },
    },
    {
      name: `${name}:config-build`,
      apply: 'build',
      config(config) {
        // make sure that Electron can be loaded into the local file using `loadFile` after packaging
        if (!config.base) config.base = './';

        if (!config.build) config.build = {};

        // ensure that static resources are loaded normally
        if (!config.build.assetsDir) config.build.assetsDir = '';

        // Rollup ---- output.external ----
        if (!config.build.rollupOptions) config.build.rollupOptions = {};

        let external = config.build.rollupOptions.external;
        const electronBuiltins = builtins.map(e => [e, `node:${e}`]).flat().concat('electron');
        if (
          Array.isArray(external) ||
          typeof external === 'string' ||
          external instanceof RegExp
        ) {
          external = electronBuiltins.concat(external);
        } else if (typeof external === 'function') {
          const original = external;
          external = function (source, importer, isResolved) {
            if (electronBuiltins.includes(source)) {
              return true;
            }
            return original(source, importer, isResolved);
          };
        } else {
          external = electronBuiltins;
        }

        // make builtin modules & electron external when rollup
        config.build.rollupOptions.external = external;
      },
    },
  ];
};

/**
 * @typedef {Record<string, import('vite-plugin-optimizer').ResultDescription>} ExportCollected
 * @type {(modules: string[]) => ExportCollected}
 */
function builtinModulesExport(modules) {
  return modules.map((moduleId) => {
    const nodeModule = require(moduleId)
    const requireModule = `const M = require("${moduleId}");`
    const exportDefault = `export default M;`
    const exportMembers = Object
      .keys(nodeModule)
      .map(attr => `export const ${attr} = M.${attr}`).join(';\n') + ';'
    const nodeModuleCode = `
${requireModule}
${exportDefault}
${exportMembers}
`

    /**
     * @type {ExportCollected}
     */
    const collect = {
      [moduleId]: {
        alias: { find: new RegExp(`^(node:)?${moduleId}$`) },
        code: nodeModuleCode,
      },
    };

    return collect;
  }).reduce((memo, item) => Object.assign(memo, item), {})
}
