
/**
 * @type {() => import('vite').Plugin}
 */
module.exports = function polyfilleExports() {
  /**
   * @type {import('vite').ResolvedConfig}
   */
  let config;

  return {
    name: 'vite-plugin-electron:polyfill-exports',
    configResolved(_config) {
      config = _config;
    },
    transformIndexHtml(html) {
      const output = config.build.rollupOptions.output;
      if (!output) return;

      const format = Array.isArray(output) ? output.find(e => e.format) : output.format;

      // https://github.com/electron-vite/vite-plugin-electron/issues/6
      // https://github.com/electron-vite/vite-plugin-electron/commit/e6decf42164bc1e3801e27984322c41b9c2724b7#r75138942
      if (['cjs', 'commonjs'].includes(format)) {
        const polyfill = `<script>var exports = typeof module !== 'undefined' ? module.exports : {};</script>`;
        return html.replace(/(<\/[\s\r\n]*?head[\s\r\n]*?>)/, polyfill + '\n$1');
      }
    },
  };
};
