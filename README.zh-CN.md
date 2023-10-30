# vite-plugin-electron

[English](https://github.com/electron-vite/vite-plugin-electron/tree/main#readme) | 简体中文

- 感谢 [@ggdream](https://github.com/ggdream) 老师提供 `vite-plugin-electron` 的 npm 包名 ❤️
- 如果这个项目有帮到了你，作者很希望你能请客来一份下午茶 ٩(๑>◡<๑)۶

## 需要留神

- 🚨 默认情况下, `electron` 文件夹下的文件将会被构建到 `dist-electron`
- 🚨 目前, Electron 尚未支持 `"type": "module"`
- 🚨 通常的，Vite 可能不能正确的构建 Node.js 的包，尤其是 C/C++ 原生模块，但是 Vite 可以将它们以外部包的形式加载。所以，请将 Node.js 包放到 `dependencies` 中。除非你知道如何用 Vite 正确的构建它们。
  ```js
  electron({
    entry: 'electron/main.ts',
    vite: {
      build: {
        rollupOptions: {
          // Here are some C/C++ modules them can't be built properly.
          external: [
            'serialport',
            'sqlite3',
          ],
        },
      },
    },
  }),
  ```

## 🍵 🍰 🍣 🍟

<img width="270" src="https://github.com/caoxiemeihao/blog/blob/main/assets/$qrcode/$.png?raw=true">
