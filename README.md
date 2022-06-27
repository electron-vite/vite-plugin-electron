# vite-plugin-electron

Integrate Vite and Electron

[![NPM version](https://img.shields.io/npm/v/vite-plugin-electron.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron)
[![NPM Downloads](https://img.shields.io/npm/dm/vite-plugin-electron.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron)

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

## API

`electron(config: Configuration)`

```ts
import type { LibraryOptions, UserConfig } from 'vite'
import type { InputOption } from 'rollup'
import type { VitePluginElectronRenderer } from 'vite-plugin-electron-renderer'

export interface CommonConfiguration {
  vite?: UserConfig
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
   * @see https://github.com/electron-vite/vite-plugin-electron-renderer
   */
  renderer?: Parameters<VitePluginElectronRenderer>[0]
}
```

## How to work

The plugin is just the encapsulation of the built-in scripts of [electron-vite-boilerplate/scripts](https://github.com/electron-vite/electron-vite-boilerplate/tree/main/scripts)

## Recommend structure

Let's use the [vanilla-ts](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-vanilla-ts) template created based on `create vite` as an example

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

## `dependencies`

Electron-Main

Note that if your pacakge is Node.js module, you need to put them in `dependencies` of `package.json`, unless you know how to build them correctly with Vite.  
*需要注意的是，如果你的包是 Node.js 的模块，那么需要放到 `package.json` 的 `dependencies` 中，除非你知道怎么用 Vite 正确的构建它们。*   

Electron-Renderer

You can see 👉 [dependencies vs devDependencies](https://github.com/electron-vite/vite-plugin-electron-renderer#dependencies-vs-devdependencies)
