# vite-plugin-electron-renderer

[![NPM version](https://img.shields.io/npm/v/vite-plugin-electron-renderer.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron-renderer)
[![NPM Downloads](https://img.shields.io/npm/dm/vite-plugin-electron-renderer.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron-renderer)

支持在渲染进程中使用 Electron and Node.Js API

[English](https://github.com/caoxiemeihao/vite-plugins/tree/main/packages/electron-renderer#readme) | 简体中文

**示例 👉 [electron-vite-vue](https://github.com/caoxiemeihao/electron-vite-vue)**
![GitHub stars](https://img.shields.io/github/stars/caoxiemeihao/electron-vite-vue?color=fa6470)

## 安装

```bash
npm i 

## 使用

**vite.config.ts**

```ts
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron-renderer'

export default defineConfig({
  plugins: [
    electron(),
  ],
})
```

**renderer.js**

```ts
import { readFile } from 'fs'
import { ipcRenderer } from 'electron'

readFile(/* something code... */)
ipcRenderer.on('event-name', () => {/* something code... */})
```

## 工作原理

- 在染进程中使用 electron

```js
import { ipcRenderer } from 'electron'
```

实际上通过 `resolve.alias` 重定向到 "[node_modules/vite-plugin-electron-renderer/modules/electron-renderer.js](modules/electron-renderer.js)"

- 在染进程中使用 Node.js API

```js
import { readFile } from 'fs'
```

所有的 Node.js API 将会通过 [vite-plugin-optimizer](https://www.npmjs.com/package/vite-plugin-optimizer) 构建到 `node_modules/.vite-plugin-electron-renderer` 目录

## 🚧 一些额外的说明

1. 首先，插件会修改一些配置

> 在你没主动配置过下列配置时，插件会修改它们的默认值

  * `base = './'`
  * `build.assetsDir = ''`
  * `build.rollupOptions.output.format = 'cjs'`
  * `resolve.conditions = ['node']`

- 将 Electron，Node.Js 内置模块和 `options.resolve` 插入到 "optimizeDeps.exclude" 中

2. 开发阶段(`vite serve`) 将 Electron 和 Node.Js 内置模块转换成 ESModule 格式

3. 打包阶段(`vite build`) 将 Electron 和 Node.Js 内置模块插入到 Rollup 的 `output.external` 中
