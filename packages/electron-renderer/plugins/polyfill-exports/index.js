/**
 * @type {import('.').PolyfillExports} 
 */
module.exports = function polyfillExports() {
  /**
   * @type {import('vite').ResolvedConfig}
   */
  let config;

  return {
    name: 'vite-plugin-electron-renderer:polyfill-exports',
    apply: 'build',
    configResolved(_config) {
      config = _config;
    },
    transformIndexHtml(html) {
      const output = config.build.rollupOptions.output;
      if (!output) return;

      const formats = ['cjs', 'commonjs'];

      // https://github.com/electron-vite/vite-plugin-electron/issues/6
      // https://github.com/electron-vite/vite-plugin-electron/commit/e6decf42164bc1e3801e27984322c41b9c2724b7#r75138942
      if (
        Array.isArray(output)
          // Once an `output.format` is CJS, it is considered as CommonJs
          ? output.find(o => formats.includes(o.format))
          : formats.includes(output.format)
      ) {
        // fix(🐞): exports is not defined
        const polyfill = `<script>var exports = typeof module !== 'undefined' ? module.exports : {};</script>`;
        return html.replace(/(<\/[\s]*?head[\s]*?>)/, polyfill + '\n$1');
      }
    },
  };
};
