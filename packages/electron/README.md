# vite-plugin-electron

Integrate Vite and Electron

[![NPM version](https://img.shields.io/npm/v/vite-plugin-electron.svg)](https://npmjs.org/package/vite-plugin-electron)
[![NPM Downloads](https://img.shields.io/npm/dm/vite-plugin-electron.svg)](https://npmjs.org/package/vite-plugin-electron)

English | [简体中文](https://github.com/electron-vite/vite-plugin-electron/tree/main/packages/electron/README.zh-CN.md)

![vite-plugin-electron.gif](https://github.com/caoxiemeihao/blog/blob/main/vite/vite-plugin-electron.gif?raw=true)

## Install

```sh
npm i vite-plugin-electron -D
```

## Usage

> Example 👉 [vite-plugin-electron-quick-start](https://github.com/caoxiemeihao/vite-plugin-electron-quick-start)

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

you can use `process.env.VITE_DEV_SERVER_URL` when the vite command is called 'serve'

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

## API

`electron(config: Configuration)`

```ts
import type { InlineConfig, LibraryOptions } from 'vite'
import type { InputOption } from 'rollup'
import { Options } from 'vite-plugin-electron-renderer'

export interface CommonConfiguration {
  vite?: InlineConfig
  /**
   * Explicitly include/exclude some CJS modules  
   * `modules` includes `dependencies` of package.json, Node.js's `builtinModules` and `electron`  
   */
  resolve?: (modules: string[]) => typeof modules | undefined
}

export interface Configuration {
  main: CommonConfiguration & {
    /**
     * Shortcut of `build.lib.entry`
     */
    entry: LibraryOptions['entry']
  }
  preload?: CommonConfiguration & {
    /**
     * Shortcut of `build.rollupOptions.input`
     */
    input: InputOption
  }
  /**
   * Support use Node.js API in Electron-Renderer
   * @see https://github.com/electron-vite/vite-plugin-electron/tree/main/packages/electron-renderer
   */
  renderer?: Options
}
```

## How to work

The plugin is just the encapsulation of the built-in scripts of [electron-vite-boilerplate/scripts](https://github.com/electron-vite/electron-vite-boilerplate/tree/main/scripts)

## Recommend structure

Let's use the official [vanilla-ts](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-vanilla-ts) template created based on `create vite` as an example

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

*🚨 By default, the files in `electron` folder will be built into the `dist/electron`*

## Put Node.js packages in dependencies

##### Electron-Main

In general, Vite may not correctly build Node.js packages, especially C/C++ native modules, but Vite can load them as external packages. So, put your Node.js package in `dependencies`. Unless you know how to properly build them with Vite.

By default, `vite-plugin-electron` treats packages in `dependencies` as `external` modules. If you don't want this, you can control this behavior with `options.resolve()`.

##### Electron-Renderer

You can see 👉 [dependencies vs devDependencies](https://github.com/electron-vite/vite-plugin-electron/tree/main/packages/electron-renderer#dependencies-vs-devdependencies)
