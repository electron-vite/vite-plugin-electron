# vite-plugin-electron-renderer

Vite 与 Electron 整合插件

[![NPM version](https://img.shields.io/npm/v/vite-plugin-electron-renderer.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron-renderer)
[![NPM Downloads](https://img.shields.io/npm/dm/vite-plugin-electron-renderer.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron-renderer)

[English](https://github.com/electron-vite/vite-plugin-electron/#readme) | 简体中文

![vite-plugin-electron.gif](https://github.com/caoxiemeihao/blog/blob/main/vite/vite-plugin-electron.gif?raw=true)

## 使用

> 示例 👉 [vite-plugin-electron-quick-start](https://github.com/caoxiemeihao/vite-plugin-electron-quick-start)

vite.config.ts

```js
import electron from 'vite-plugin-electron'

export default {
  plugins: [
    electron({
      main: {
        entry: 'electron/main.ts',
      },
    }),
  ],
}
```

## API

`electron(config: Configuration)`

```ts
import type { LibraryOptions, UserConfig } from 'vite'
import type { InputOption } from 'rollup'

export interface Configuration {
  main: {
    /**
     * Shortcut of `build.lib.entry`
     */
    entry: LibraryOptions['entry']
    vite?: UserConfig
  }
  preload?: {
    /**
     * Shortcut of `build.rollupOptions.input`
     */
    input: InputOption
    vite?: UserConfig
  }
}
```
## 工作原理

该插件只是 [electron-vite-boilerplate/scripts](https://github.com/electron-vite/electron-vite-boilerplate/tree/main/scripts) 下脚本的封装

## 推荐结构

这里使用基于 `create vite` 创建的 [vanilla-ts](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-vanilla-ts) 模板为例 🌰

```diff
+ ├─┬ electron
+ │ └── main.ts
  ├─┬ src
  │ ├── main.ts
  │ ├── style.css
  │ └── vite-env.d.ts
  ├── .gitignore
  ├── favicon.svg
  ├── index.html
  ├── package.json
  ├── tsconfig.json
+ └── vite.config.ts
```

*🚨 默认情况下, `electron` 文件夹下的文件将会被构建到 `dist/electron`*

🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧

# vite-plugin-electron/renderer

在 Electron 渲染进程中使用 Electron 与 Node.js API

> 如果你只想打包渲染进程 Renderer-process, 那么你只需要 `vite-plugin-electron/renderer` 插件

🌰 例子 👉 [electron-vite-boilerplate/packages/renderer/vite.config.ts](https://github.com/electron-vite/electron-vite-boilerplate/blob/main/packages/renderer/vite.config.ts)
![GitHub stars](https://img.shields.io/github/stars/caoxiemeihao/electron-vite-boilerplate?color=fa6470)

## 使用

vite.config.ts

```js
import renderer from 'vite-plugin-electron/renderer'

export default {
  plugins: [
    renderer(),
  ],
}
```

renderer.js

```ts
import { readFile } from 'fs'
import { ipcRenderer } from 'electron'

readFile(/* something code... */)
ipcRenderer.on('event-name', () => {/* something code... */})
```

## 工作原理

在渲染进程中使用 Renderer-process 中使用 Electron API

```js
import { ipcRenderer } from 'electron'
↓
// 实际上会通过 `resolve.alias` 重定向
import { ipcRenderer } from 'vite-plugin-electron/renderer/modules/electron-renderer.js'
```

在渲染进程 Renderer-process 中使用 Node.js API

```js
import { readFile } from 'fs'
↓
// 所有 Node.js API 通过 `resolve.alias` 重定向到由 `vite-plugin-optimizer` 构建后的目录
import { readFile } from '.vite-plugin-electron-renderer/fs'
```

预设配置

1. 首先，插件会修改一些配置
  *在你没主动配置过下列配置时，插件会修改它们的默认值*

  * `base = './'`
  * `build.assetsDir = ''` -> *TODO: Automatic splicing `build.assetsDir`*
  * `build.emptyOutDir = false`
  * `build.cssCodeSplit = false`
  * `build.rollupOptions.output.format = 'cjs'`
  * `resolve.conditions = ['node']`
  * 总是将 `electron` 模块插入到 `optimizeDeps.exclude` 中

2. 开发阶段(`vite serve`) 将 Electron 和 Node.Js 内置模块转换成 ESModule 格式

3. 打包阶段(`vite build`) 将 Electron 和 Node.Js 内置模块插入到 Rollup 的 `output.external` 中

## FAQ

你可能需要在 Main-process/Renderer-process 使用一些 npm 模块，我建议你好好看看 [electron-vite-boilerplate](https://github.com/electron-vite/electron-vite-boilerplate).
