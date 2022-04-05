# vite-plugin-electron-renderer

[![NPM version](https://img.shields.io/npm/v/vite-plugin-electron-renderer.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron-renderer)
[![NPM Downloads](https://img.shields.io/npm/dm/vite-plugin-electron-renderer.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron-renderer)

Use Electron and Node.js API in Renderer-process

English | [简体中文](https://github.com/caoxiemeihao/vite-plugins/blob/main/packages/electron-renderer/README.zh-CN.md)

**Example 👉 [electron-vite-vue](https://github.com/caoxiemeihao/electron-vite-vue)**
![GitHub stars](https://img.shields.io/github/stars/caoxiemeihao/electron-vite-vue?color=fa6470)

## Install

```bash
npm i vite-plugin-electron-renderer -D
```

## Usage

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

## How to work

- Using Electron API in Renderer-process

```js
import { ipcRenderer } from 'electron'
```

Actually redirect to "[node_modules/vite-plugin-electron-renderer/modules/electron-renderer.js](modules/electron-renderer.js)" by `resolve.alias`

- Using Node.js API in Renderer-process

```js
import { readFile } from 'fs'
```

All Node.js API will be built into the `node_modules/.vite-plugin-electron-renderer` directory by [vite-plugin-optimizer](https://www.npmjs.com/package/vite-plugin-optimizer)


## 🚧 Some additional instructions

1. Fist, the plugin will configuration something.

> If you do not configure the following options, the plugin will modify their default values

  * `base = './'`
  * `build.assetsDir = ''` -> *TODO: Automatic splicing "build.assetsDir"*
  * `build.rollupOptions.output.format = 'cjs'`
  * `resolve.conditions = ['node']`

2. The plugin transform Electron and Node.js built-in modules to ESModule format in "vite serve" phase.

3. Add Electron and Node.js built-in modules to Rollup "output.external" option in the "vite build" phase.
