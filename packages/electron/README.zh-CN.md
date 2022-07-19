# vite-plugin-electron

[English](https://github.com/electron-vite/vite-plugin-electron/tree/main/packages/electron#readme) | 简体中文

## 将 Node.js 包放到 `dependencies` 中

##### Electron-Main

通常的，Vite 可能不能正确的构建 Node.js 的包，尤其是 C/C++ 原生模块，但是 Vite 可以将它们以外部包的形式加载。所以，请将 Node.js 包放到 `dependencies` 中。除非你知道如何用 Vite 正确的构建它们。

默认情况下，`vite-plugin-electron` 会将 `dependencies` 中的包视为 `external` 模块。如果你不希望这样，你可以通过 `options.resolve()` 来控制该行为。

##### Electron-Renderer

看看这 👉 [dependencies vs devDependencies](https://github.com/electron-vite/vite-plugin-electron/tree/main/packages/electron-renderer#dependencies-vs-devdependencies)

