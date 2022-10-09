import type { ResolvedConfig, Plugin } from 'vite'

export default function cjsShim(): Plugin {
  let config: ResolvedConfig

  return {
    name: 'vite-plugin-electron-renderer:cjs-shim',
    apply: 'build',
    configResolved(_config) {
      config = _config
    },
    transformIndexHtml(html) {
      const headRE = /(<\s*?head\s*?>)/
      // const headeRE = /(<\/[\s]*?head[\s]*?>)/

      // ---------------------------------------- shim-require-id
      const assetsDir = config.build.assetsDir
      if (assetsDir) {
        const requireIdShim = `<script id="shim-require-id">
; (function () {
  var Module = require('module');
  var _resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    // "assetsDir" is always at the same level as "index.html"
    var prefix = './';
    if (request.startsWith(prefix)) {
      try {
        // TODO: The way is more elegant.
        var newRequest = request.replace(prefix, prefix + '${assetsDir + "/"}');
        return _resolveFilename.call(this, newRequest, parent, isMain, options);
      } catch (error) { }
    }
    return _resolveFilename.call(this, request, parent, isMain, options);
  };
})();
</script>`
        html = html.replace(headRE, '$1\n' + requireIdShim)
      }

      // ---------------------------------------- shim-exports
      const output = config.build.rollupOptions.output
      if (output) {
        const formats = ['cjs', 'commonjs']

        // https://github.com/electron-vite/vite-plugin-electron/issues/6
        // https://github.com/electron-vite/vite-plugin-electron/commit/e6decf42164bc1e3801e27984322c41b9c2724b7#r75138942
        if (
          Array.isArray(output)
            // Once an `output.format` is CJS, it is considered as CommonJs
            ? output.find(o => formats.includes(o.format as string))
            : formats.includes(output.format as string)
        ) {
          // fix(🐞): exports is not defined
          const exportsShim = `<script id="shim-exports">var exports = typeof module !== 'undefined' ? module.exports : {};</script>`
          html = html.replace(headRE, '$1\n' + exportsShim)
        }
      }

      return html
    }
  }
}
