# vite-plugin-electron

Integrate Vite and Electron

[![NPM version](https://img.shields.io/npm/v/vite-plugin-electron.svg)](https://npmjs.org/package/vite-plugin-electron)
[![NPM Downloads](https://img.shields.io/npm/dm/vite-plugin-electron.svg)](https://npmjs.org/package/vite-plugin-electron)

English | [简体中文](https://github.com/electron-vite/vite-plugin-electron/blob/main/README.zh-CN.md)

- 🐣 Few APIs, easy to use
- 🚀 Fully compatible with Vite and Vite's ecosystem

![vite-plugin-electron.gif](https://github.com/caoxiemeihao/blog/blob/main/vite/vite-plugin-electron.gif?raw=true)

## Install

```sh
npm i vite-plugin-electron -D
```

## Examples

- [quick-start](https://github.com/caoxiemeihao/vite-plugin-electron/tree/main/examples/quick-start)
- [custom-start-electron-app](https://github.com/caoxiemeihao/vite-plugin-electron/tree/main/examples/custom-start-electron-app)

## Usage

vite.config.ts

```js
import electron from 'vite-plugin-electron'

export default {
  plugins: [
    electron({
      entry: 'electron/main.ts',
    }),
  ],
}
```

You can use `process.env.VITE_DEV_SERVER_URL` when the vite command is called 'serve'

```js
// electron main.js
const win = new BrowserWindow({
  title: 'Main window',
})

if (process.env.VITE_DEV_SERVER_URL) {
  win.loadURL(process.env.VITE_DEV_SERVER_URL)
} else {
  // load your file
  win.loadFile('yourOutputFile.html');
}
```

## API <sub><sup>(Define)</sup></sub>

`electron(config: Configuration | Configuration[])`

```ts
export interface Configuration {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry?: import('vite').LibraryOptions['entry']
  vite?: import('vite').InlineConfig
  /**
   * Triggered when Vite is built every time.
   * 
   * If this `onstart` is passed, Electron App will not start automatically.  
   * However, you can start Electroo App via `startup` function.  
   */
  onstart?: (this: import('rollup').PluginContext, options: {
    /**
     * Electron App startup function
     * @param argv default value `['.', '--no-sandbox']`
     */
    startup: (argv?: string[]) => Promise<void>
    /** Reload Electron-Renderer */
    reload: () => void
  },
  ) => void
}
```

## How to work

The plugin is just the encapsulation of the built-in scripts of [electron-vite-boilerplate/scripts](https://github.com/electron-vite/electron-vite-boilerplate/tree/main/scripts)

## Recommend structure

Let's use the official [template-vanilla-ts](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-vanilla-ts) created based on `create vite` as an example

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

- *🚨 By default, the files in `electron` folder will be built into the `dist/electron`*
- *🚨 Currently, `"type": "module"` is not supported in Electron*

## Put Node.js packages in dependencies

<!-- ##### Electron-Main -->

In general, Vite may not correctly build Node.js packages, especially C/C++ native modules, but Vite can load them as external packages. So, put your Node.js package in `dependencies`. Unless you know how to properly build them with Vite.

By default, `vite-plugin-electron` treats packages in `dependencies` as `external` modules.

<!-- ##### Electron-Renderer

You can see 👉 [dependencies vs devDependencies](https://github.com/electron-vite/vite-plugin-electron-renderer#dependencies-vs-devdependencies) -->
