# vite-plugin-electron-renderer

Support use Node.js API in Electron-Renderer

[![NPM version](https://img.shields.io/npm/v/vite-plugin-electron-renderer.svg)](https://npmjs.org/package/vite-plugin-electron-renderer)
[![NPM Downloads](https://img.shields.io/npm/dm/vite-plugin-electron-renderer.svg)](https://npmjs.org/package/vite-plugin-electron-renderer)

English | [简体中文](https://github.com/electron-vite/vite-plugin-electron/blob/main/packages/electron-renderer/README.zh-CN.md)

## Install

```sh
npm i vite-plugin-electron-renderer -D
```

## Examples

- [nodeIntegration](https://github.com/caoxiemeihao/vite-plugin-electron/tree/main/examples/nodeIntegration)
- [worker](https://github.com/caoxiemeihao/vite-plugin-electron/tree/main/examples/worker)

## Usage

vite.config.ts

```js
import renderer from 'vite-plugin-electron-renderer'

export default {
  plugins: [
    renderer(/* options */),
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

API *(Define)*

`renderer(options: RendererOptions)`

```ts
export interface RendererOptions {
  /**
   * Explicitly include/exclude some CJS modules  
   * `modules` includes `dependencies` of package.json  
   */
  resolve?: (modules: string[]) => string[] | void
  /**
   * Whether node integration is enabled. Default is `false`.
   */
  nodeIntegration?: boolean
}
```

## Worker

vite.config.ts

```js
import { worker } from 'vite-plugin-electron-renderer'

export default {
  worker: {
    plugins: [
      worker(/* options */),
    ],
  },
}
```

API *(Define)*

`renderer(options: WorkerOptions)`

```ts
export interface WorkerOptions {
  /**
   * Explicitly include/exclude some CJS modules  
   * `modules` includes `dependencies` of package.json  
   */
  resolve?: (modules: string[]) => string[] | void
  /**
   * Whether node integration is enabled in web workers. Default is `false`. More
   * about this can be found in Multithreading.
   */
  nodeIntegrationInWorker?: boolean
}
```

## `dependencies` vs `devDependencies`

> In general, Vite may not correctly build Node.js packages, especially Node.js C/C++ native modules, but Vite can load them as external packages. **Unless you know how to properly build them with Vite.**

<table>
  <thead>
    <th>Classify</th>
    <th>e.g.</th>
    <th>dependencies</th>
    <th>devDependencies</th>
  </thead>
  <tbody>
    <tr>
      <td>Node.js C/C++ native modules</td>
      <td>serialport, sqlite3</td>
      <td>✅</td>
      <td>❌</td>
    </tr>
    <tr>
      <td>Node.js CJS packages</td>
      <td>electron-store</td>
      <td>✅</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>Node.js ESM packages</td>
      <td>execa, got, node-fetch</td>
      <td>✅</td>
      <td>✅ (Recommend)</td>
    </tr>
    <tr>
      <td>Web packages</td>
      <td>Vue, React</td>
      <td>✅</td>
      <td>✅ (Recommend)</td>
    </tr>
  </tbody>
</table>

First, put the Node.js(CJS) packages into `dependencies`.

Second, you need to explicitly specify which packages are Node.js(CJS) packages for `vite-plugin-electron-renderer` by `options.resolve()`. This way they will be treated as `external` modules and loaded correctly. Thereby avoiding the problems caused by the Pre-Bundling of Vite.

It's essentially works principle is to generate a virtual module in ESM format by `load-hook` during `vite serve` to ensure that it can work normally. It's inserted into `rollupOptions.external` during `vite build` time.

#### Load Node.js C/C++ native modules

```js
renderer({
  resolve() {
    // explicitly specify which packages are Node.js(CJS) packages
    return [
      // C/C++ native modules
      'serialport',
      'sqlite3',
    ]
  }
})
```

#### Load Node.js CJS packages/builtin-modules/electron (Schematic)

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

#### Node.js ESM packages

###### The first way

In general, Node.js ESM packages only need to be converted if they are used in Electron-Renderer. But not in Electron-Main.

1. Install [vite-plugin-esmodule](https://github.com/vite-plugin/vite-plugin-esmodule) to load ESM packages
2. It is recommended to put the ESM packages in the `devDependencies`

> [See an explanation of it](https://github.com/electron-vite/vite-plugin-electron/blob/b4d616a8d0e25f01f5e589b4a6ef69220866ce5d/examples/nodeIntegration/vite.config.ts#L21-L24)

###### The second way

```diff
export default {
+ optimizeDeps: {
+   exclude: ['only-support-pure-esmodule-package']
+ }
}
```

#### Why is it recommended to put properly buildable packages in `devDependencies`?

Doing so will reduce the size of the packaged APP by [electron-builder](https://github.com/electron-userland/electron-builder).

## How to work

The plugin is just the encapsulation of the built-in plugins of [electron-vite-boilerplate/packages/renderer/plugins](https://github.com/electron-vite/electron-vite-boilerplate/tree/main/packages/renderer/plugins).

## Config presets (Opinionated)

If you do not configure the following options, the plugin will modify their default values

- `base = './'`
- `build.emptyOutDir = false`
- `build.cssCodeSplit = false` (*TODO*)
- `build.rollupOptions.output.format = 'cjs'` (nodeIntegration: true)
- `resolve.conditions = ['node']`
- `optimizeDeps.exclude = ['electron']` - always
