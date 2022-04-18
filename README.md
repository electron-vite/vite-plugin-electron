# vite-plugin-electron

[![NPM version](https://img.shields.io/npm/v/vite-plugin-electron.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron)
[![NPM Downloads](https://img.shields.io/npm/dm/vite-plugin-electron.svg?style=flat)](https://npmjs.org/package/vite-plugin-electron)

Integrate Vite and Electron

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
        entry: 'electron-main.ts',
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

The plugin is just the encapsulation of the built-in scripts of [electron-vite-vue/scripts](https://github.com/electron-vite/electron-vite-vue/tree/main/scripts)

🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧

# vite-plugin-electron/renderer

Use Electron and Node.js API in Renderer-process

> If you only need to build the Renderer-process, you can just use the `vite-plugin-electron/renderer` plugin

Example 👉 [electron-vite-vue/packages/renderer/vite.config.ts](https://github.com/electron-vite/electron-vite-vue/blob/main/packages/renderer/vite.config.ts)
![GitHub stars](https://img.shields.io/github/stars/caoxiemeihao/electron-vite-vue?color=fa6470)

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

Actually redirect to [node_modules/vite-plugin-electron/renderer/modules/electron-renderer.js](https://github.com/electron-vite/vite-plugin-electron/blob/main/renderer/modules/electron-renderer.js) by `resolve.alias`

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

You may need to use some Node.js modules from npm in the Main-process/Renderer-process.  
I suggest you look at [electron-vite-vue](https://github.com/electron-vite/electron-vite-vue).

---

When we use Node.js API in the Renderer-process, we will build the code into the CommonJs format.  
Sometimes it will cause the console to report an error `exports is not defined`.  
Now, before we find the answer, we can fix it using the **vite-plugin-electron/polyfill-exports**

```js
import polyfillExports from 'vite-plugin-electron/polyfill-exports'

export default {
  plugins: [
    polyfillExports(),
  ],
  build: {
    rollupOptions: {
      output: {
        // Errors may occur
        format: 'cjs',
      }
    }
  }
}
```

