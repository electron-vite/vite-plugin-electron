# vite-plugin-electron

Integrate Vite and Electron

[![NPM version](https://img.shields.io/npm/v/vite-plugin-electron.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron)
[![NPM Downloads](https://img.shields.io/npm/dm/vite-plugin-electron.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron)

English | [简体中文](https://github.com/electron-vite/vite-plugin-electron/blob/main/README.zh-CN.md)

![vite-plugin-electron.gif](https://github.com/caoxiemeihao/blog/blob/main/vite/vite-plugin-electron.gif?raw=true)

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

🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧

# vite-plugin-electron/renderer

Use Electron and Node.js API in Renderer-process

> If you only need to build the Renderer-process, you can just use the `vite-plugin-electron/renderer` plugin

Example 👉 [electron-vite-boilerplate/packages/renderer/vite.config.ts](https://github.com/electron-vite/electron-vite-boilerplate/blob/main/packages/renderer/vite.config.ts)
![GitHub stars](https://img.shields.io/github/stars/caoxiemeihao/electron-vite-boilerplate?color=fa6470)

## Usage

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

## How to work

Using Electron API in Renderer-process

```js
import { ipcRenderer } from 'electron'
↓
// Actually will redirect by `resolve.alias`
import { ipcRenderer } from 'vite-plugin-electron/renderer/modules/electron-renderer.js'
```

Using Node.js API in Renderer-process

```js
import { readFile } from 'fs'
↓
// All Node.js API will redirect to the directory created based on `vite-plugin-optimizer` by `resolve.alias`
import { readFile } from '.vite-plugin-electron-renderer/fs'
```

Config presets

1. Fist, the plugin will configuration something.
  *If you do not configure the following options, the plugin will modify their default values*

  * `base = './'`
  * `build.assetsDir = ''` -> *TODO: Automatic splicing `build.assetsDir`*
  * `build.emptyOutDir = false`
  * `build.cssCodeSplit = false`
  * `build.rollupOptions.output.format = 'cjs'`
  * `resolve.conditions = ['node']`
  * Always insert the `electron` module into `optimizeDeps.exclude`

2. The plugin transform Electron and Node.js built-in modules to ESModule format in `vite serve` phase.

3. Add Electron and Node.js built-in modules to Rollup `output.external` option in the `vite build` phase.

## FAQ

You may need to use some Node.js modules from npm in the Main-process/Renderer-process.  
I suggest you look at [electron-vite-boilerplate](https://github.com/electron-vite/electron-vite-boilerplate).
