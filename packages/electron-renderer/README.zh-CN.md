# vite-plugin-electron-renderer

[English](https://github.com/electron-vite/vite-plugin-electron/tree/main/packages/electron-renderer#readme) | 简体中文

## `dependencies` 与 `devDependencies`

> 通常的，Vite 可能不能正确的构建 Node.js 包，尤其是 Node.js C/C++ 原生模块，但是 Vite 可以将它们以外部包(`external`)的形式加载它们。**除非你知道如何用 Vite 正确的构建它们 -- 鲁迅**

<table>
  <thead>
    <th>分类</th>
    <th>🌰</th>
    <th>dependencies</th>
    <th>devDependencies</th>
  </thead>
  <tbody>
    <tr>
      <td>Node.js C/C++ 原生模块</td>
      <td>serialport, sqlite3</td>
      <td>✅</td>
      <td>❌</td>
    </tr>
    <tr>
      <td>Node.js CJS 包</td>
      <td>electron-store</td>
      <td>✅</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>Node.js ESM 包</td>
      <td>execa, got, node-fetch</td>
      <td>✅</td>
      <td>✅ (推荐)</td>
    </tr>
    <tr>
      <td>Web 包</td>
      <td>Vue, React</td>
      <td>✅</td>
      <td>✅ (推荐)</td>
    </tr>
  </tbody>
</table>

首先将 Node.js(CJS) 包放到 `dependencies` 中。

其次需要通过 `options.resolve()` 显式的告诉 `vite-plugin-electron-renderer` 哪些包是 Node.js(CJS) 包。这样它们将会被视为 `external` 模块并可以正确的加载。从而避开 Vite 的预构建带来的问题。

其背后的运行原理是在 `vite serve` 期间会通过 `load-hook` 生成一个 ESM 格式的虚拟模块，以保障其能够正常工作。在 `vite build` 期间会将其插入到 `rollupOptions.external` 中。

#### Node.js C/C++ 原生模块

```js
renderer({
  resolve() {
    // 显式的告诉 `vite-plugin-electron-renderer` 下面的包是 Node.js(CJS) 模块
    return [
      // C/C++ 原生模块
      'serialport',
      'sqlite3',
    ]
  }
})
```

#### 加载 Node.js CJS 包/内置模块/electron (示意图)

###### Electron-Renderer(vite build)

```js
import { ipcRenderer } from 'electron'
↓
const { ipcRenderer } = require('electron')
```

###### Electron-Renderer(vite serve)

```
┏————————————————————————————————————————┓                    ┏—————————————————┓
│ import { ipcRenderer } from 'electron' │                    │ Vite dev server │
┗————————————————————————————————————————┛                    ┗—————————————————┛
                   │                                                   │
                   │ 1. HTTP(Request): electron module                 │
                   │ ————————————————————————————————————————————————> │
                   │                                                   │
                   │                                                   │
                   │ 2. Intercept in load-hook(Plugin)                 │
                   │ 3. Generate a virtual ESM module(electron)        │
                   │    ↓                                              │
                   │    const { ipcRenderer } = require('electron')    │
                   │    export { ipcRenderer }                         │
                   │                                                   │
                   │                                                   │
                   │ 4. HTTP(Response): electron module                │
                   │ <———————————————————————————————————————————————— │
                   │                                                   │
┏————————————————————————————————————————┓                    ┏—————————————————┓
│ import { ipcRenderer } from 'electron' │                    │ Vite dev server │
┗————————————————————————————————————————┛                    ┗—————————————————┛
```

#### Node.js ESM 包

通常的，只有在 Electron-Renderer 中使用的情况下才需要转换 Node.js ESM 模块，而在 Electron-Main 中使用则不必转换。

1. 安装 [vite-plugin-esmodule](https://github.com/vite-plugin/vite-plugin-esmodule) 插件加载 ESM 包。
2. 推荐将 ESM 包辅导会 `devDependencies` 中。

#### 为什么推荐将可以正确构建的包放到 `devDependencies` 中？

这样做会减小 [electron-builder](https://github.com/electron-userland/electron-builder) 打包后的应用体积。
