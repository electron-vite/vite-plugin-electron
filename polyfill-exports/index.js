
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

      // https://github.com/electron-vite/electron-vite-vue/issues/103#issuecomment-1097540635
      if (['cjs', 'commonjs'].includes(format)) {
        const polyfill = '<script>var exports = {};</script>';
        return html.replace(/(<\/[\s\r\n]*?head[\s\r\n]*?>)/, polyfill + '\n$1');
      }
    },
  };
};
