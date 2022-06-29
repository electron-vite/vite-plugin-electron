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

## Put Node.js packages in dependencies

**Electron-Main**

In general, Vite may not correctly build Node.js packages, especially C/C++ native modules, but Vite can load them as external packages. So, put your Node.js package in `dependencies`. Unless you know how to properly build them with Vite.

By default, `vite-plugin-electron` treats packages in `dependencies` as `external` modules. If you don't want this, you can control this behavior with `options.resolve()`.

*通常的，Vite 可能不能正确的构建 Node.js 的包，尤其是 C/C++ 原生模块，但是 Vite 可以将它们以外部包的形式加载。所以，请将 Node.js 包放到 `dependencies` 中。除非你知道如何用 Vite 正确的构建它们。*

*默认情况下，`vite-plugin-electron` 会将 `dependencies` 中的包视为 `external` 模块。如果你不希望这样，你可以通过 `options.resolve()` 来控制改行为。*

**Electron-Renderer**

You can see 👉 [dependencies vs devDependencies](https://github.com/electron-vite/vite-plugin-electron-renderer#dependencies-vs-devdependencies)
