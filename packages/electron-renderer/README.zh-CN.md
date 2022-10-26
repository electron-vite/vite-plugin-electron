# vite-plugin-electron-renderer

[English](https://github.com/electron-vite/vite-plugin-electron/tree/main/packages/electron-renderer#readme) | 简体中文

## 原理

> 加载 Electron、Node.js CJS 包/内置模块/electron (示意图)

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

###### Electron-Renderer(vite build)

```js
import { ipcRenderer } from 'electron'
↓
const { ipcRenderer } = require('electron')
```

###### Electron-Renderer(vite build)

```js
import { ipcRenderer } from 'electron'
↓
const { ipcRenderer } = require('electron')
```

## Dependency Pre-Bundling

When you run vite for the first time, you may notice this message:

```log
$ vite
Pre-bundling: serialport
Pre-bundling: electron-store
Pre-bundling: execa
Pre-bundling: node-fetch
Pre-bundling: got
```

#### 为啥

**通常的**，Vite 可能不能正确的构建 Node.js 包，尤其是 Node.js C/C++ 原生模块，但是 Vite 可以将它们以外部包(`external`)的形式加载它们。  
**除非你知道如何用 Vite 正确的构建它们 -- 鲁迅** 
[使用案例](https://github.com/electron-vite/vite-plugin-electron/blob/14684ba108beec305edf4c9d8865527f6508f987/examples/nodeIntegration/vite.config.ts#L17-L26)

**顺带说一句**. 如果一个 npm 包是个一纯 ESM 格式包，并且它自身的依赖也是 ESM 格式包，那么直接包名放到 `optimizeDeps.exclude` 中即可正常使用。   
[这里解释了它](https://github.com/electron-vite/vite-plugin-electron/blob/14684ba108beec305edf4c9d8865527f6508f987/examples/nodeIntegration/vite.config.ts#L36-L39)

## `dependencies` 与 `devDependencies`

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

#### 为啥推荐将可以正确构建的包放到 `devDependencies` 中？

这样做会减小 [electron-builder](https://github.com/electron-userland/electron-builder) 打包后的应用体积。
