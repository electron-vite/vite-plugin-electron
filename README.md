# vite-plugin-electron

Integrate Vite and Electron

[![NPM version](https://img.shields.io/npm/v/vite-plugin-electron.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron)
[![NPM Downloads](https://img.shields.io/npm/dm/vite-plugin-electron.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron)

Example 👉 [vite-plugin-electron-quick-start](https://github.com/caoxiemeihao/vite-plugin-electron-quick-start)

## Usage

vite.config.ts

```js
import electron from 'vite-plugin-electron'
import electronConfig from './vite-electron.config'

export {
  plugins: [
    electron(electronConfig),
  ],
}
```

vite-electron.config.ts

```js
import { defineConfig } from 'vite-plugin-electron'

export default defineConfig({
  main: {
    entry: 'electron-main.ts',
  },
})
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

This plugin is just a builtin scripts of [electron-vite-boilerplate](https://github.com/electron-vite/electron-vite-boilerplate)

---

# vite-plugin-electron/renderer

Use Electron and Node.js API in Renderer-process

> If you only need to build the Renderer-process, you can just use the `vite-plugin-electron/renderer` plugin

Example 👉 [electron-vite-boilerplate](https://github.com/electron-vite/electron-vite-boilerplate)
![GitHub stars](https://img.shields.io/github/stars/caoxiemeihao/electron-vite-boilerplate?color=fa6470)

```js
// renderer/vite.config.ts
import electronRenderer from 'vite-plugin-electron/renderer'

export default {
  plugins: [
    electronRenderer(),
  ],
}
```


## Usage

vite.config.ts

```js
import electronRenderer from 'vite-plugin-electron/renderer'

export default {
  plugins: [
    electronRenderer(),
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

**Using Electron API in Renderer-process**

```js
import { ipcRenderer } from 'electron'
```

Actually redirect to [node_modules/vite-plugin-electron/renderer/modules/electron-renderer.js](modules/electron-renderer.js) by `resolve.alias`

**Using Node.js API in Renderer-process**

```js
import { readFile } from 'fs'
```

All Node.js API will be built into the `node_modules/.vite-plugin-electron-renderer` directory by [vite-plugin-optimizer](https://www.npmjs.com/package/vite-plugin-optimizer)


**Config presets**

1. Fist, the plugin will configuration something.

> If you do not configure the following options, the plugin will modify their default values

  * `base = './'`
  * `build.assetsDir = ''` -> *TODO: Automatic splicing `build.assetsDir`*
  * `build.rollupOptions.output.format = 'cjs'`
  * `resolve.conditions = ['node']`

2. The plugin transform Electron and Node.js built-in modules to ESModule format in `vite serve` phase.

3. Add Electron and Node.js built-in modules to Rollup `output.external` option in the `vite build` phase.

## FAQ

1. You may need to use some Node.js modules from npm in the Main-process/Renderer-process  
  I suggest you look at [electron-vite-boilerplate](https://github.com/electron-vite/electron-vite-boilerplate)
