<p align="center">
  <img width="170" src="https://github.com/electron-vite/vite-plugin-electron/blob/main/logo.svg?raw=true">
</p>
<div align="center">
  <h1>vite-plugin-electron</h1>
</div>
<p align="center">Electron 🔗 Vite</p>
<p align="center">
  <a href="https://npmjs.com/package/vite-plugin-electron">
    <img src="https://img.shields.io/npm/v/vite-plugin-electron.svg">
  </a>
  <a href="https://npmjs.com/package/vite-plugin-electron">
    <img src="https://img.shields.io/npm/dm/vite-plugin-electron.svg">
  </a>
  <a href="https://discord.gg/YfjFuEgVUR">
    <img src="https://img.shields.io/badge/chat-discord-blue?logo=discord">
  </a>
</p>
<p align="center">
  <strong>
    <span>English</span>
    |
    <a href="https://github.com/electron-vite/vite-plugin-electron/blob/main/README.zh-CN.md">简体中文</a>
  </strong>
</p>

<br/>

In short, `vite-plugin-electron` makes developing Electron apps as easy as normal Vite projects.

> [!important]
> This project will drop support for `vite@<8` in the upcoming `v1` release.
> For users needing Vite 7 compatibility, use `v0.29.1`. it is stable and production-ready.

## Features

- [🔥 Hot Restart <sub><sup>(Main process)</sup></sub>](https://electron-vite.github.io/guide/features.html#hot-restart)
- [🔄 Hot Reload <sub><sup>(Preload scripts)</sup></sub>](https://electron-vite.github.io/guide/features.html#hot-reload)
- [⚡️ HMR <sub><sup>(Renderer process)</sup></sub>](https://electron-vite.github.io/guide/features.html#hmr)
<!-- - [🚀 Not Bundle, It's fast <sub><sup>(Like Vite's Not Bundle)</sup></sub>](https://github.com/electron-vite/vite-plugin-electron#not-bundle) -->
- 🌱 Fully compatible with Vite and Vite's ecosystem <sub><sup>(Based on Vite)</sup></sub>
- 🔮 Full-featured [JavaScript API](https://github.com/electron-vite/vite-plugin-electron#javascript-api), really easy to integrate with complex projects.
- 🐣 Few APIs, easy to use

<!-- ![vite-plugin-electron.gif](https://github.com/electron-vite/vite-plugin-electron/blob/main/vite-plugin-electron.gif?raw=true) -->

## Quick Setup

1. Add the following dependency to your project

```sh
npm i -D vite-plugin-electron
```

2. Add `vite-plugin-electron` to the `plugins` section of `vite.config.ts`

```js
import electron from 'vite-plugin-electron/simple'

export default {
  plugins: [
    electron({
      main: {
        // Shortcut of `build.lib.entry`
        entry: 'electron/main.ts',
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`
        input: 'electron/preload.ts',
      },
      // Optional: Use Node.js API in the Renderer process
      renderer: {},
    }),
  ],
}
```

3. Create the `electron/main.ts` file and type the following code

```js
import { app, BrowserWindow } from 'electron'

app.whenReady().then(() => {
  const win = new BrowserWindow({
    title: 'Main window',
  })

  // You can use `process.env.VITE_DEV_SERVER_URL` when the vite command is called `serve`
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    // Load your file
    win.loadFile('dist/index.html')
  }
})
```

4. Add the `main` entry to `package.json`

```diff
{
+ "main": "dist-electron/main.mjs"
}
```

That's it! You can now use Electron in your Vite app ✨

## Flat API

In most cases, the `vite-plugin-electron/simple` API is recommended. If you know very well how this plugin works or you want to use `vite-plugin-electron` API as a secondary encapsulation of low-level API, then the flat API is more suitable for you. It is also simple but more flexible. :)

The difference compared to the simple API is that it does not identify which entry represents `preload` and the adaptation to preload.

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

## Flat API vs Simple API

- Simple API is based on the Flat API
- Simple API incluess some Preload scripts preset configs.
- Flat API provides some more general APIs, which you can use for secondary encapsulation, such as [nuxt-electron](https://github.com/caoxiemeihao/nuxt-electron).

## Flat API <sub><sup>(Define)</sup></sub>

`electron(options: ElectronOptions | ElectronOptions[])`

```ts
export interface ElectronOptions {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry?: import('vite').LibraryOptions['entry']
  vite?: import('vite').InlineConfig
  /**
   * Triggered when Vite is built every time -- `vite serve` command only.
   *
   * If this `onstart` is passed, Electron App will not start automatically.
   * However, you can start Electroo App via `startup` function.
   */
  onstart?: (args: {
    /**
     * Electron App startup function.
     * It will mount the Electron App child-process to `process.electronApp`.
     * @param argv default value `['.', '--no-sandbox']`
     * @param options options for `child_process.spawn`
     * @param customElectronPkg custom electron package name (default: 'electron')
     */
    startup: (
      argv?: string[],
      options?: import('node:child_process').SpawnOptions,
      customElectronPkg?: string,
    ) => Promise<void>
    /** Reload Electron-Renderer */
    reload: () => void
  }) => void | Promise<void>
}
```

## Recommend Structure

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

## Built format

This is just the default behavior, and you can modify them at any time through custom config in the `vite.config.js`

```log
{ "type": "module" }
┏————————————————————┳——————————┳———————————┓
│       built        │  format  │   suffix  │
┠————————————————————╂——————————╂———————————┨
│ main process       │   esm    │    .js    │
┠————————————————————╂——————————╂———————————┨
│ preload scripts    │   cjs    │   .mjs    │ diff
┠————————————————————╂——————————╂———————————┨
│ renderer process   │    -     │    .js    │
┗————————————————————┸——————————┸———————————┛

{ "type": "commonjs" } - default
┏————————————————————┳——————————┳———————————┓
│       built        │  format  │   suffix  │
┠————————————————————╂——————————╂———————————┨
│ main process       │   cjs    │    .js    │
┠————————————————————╂——————————╂———————————┨
│ preload scripts    │   cjs    │    .js    │ diff
┠————————————————————╂——————————╂———————————┨
│ renderer process   │    -     │    .js    │
┗————————————————————┸——————————┸———————————┛
```

## Examples

There are many cases here 👉 [electron-vite-samples](https://github.com/caoxiemeihao/electron-vite-samples)

## Playground

The local demo suite lives in [playground/](playground/README.md) and includes separate flat and simple modes that import the plugin source directly from this repo.

## JavaScript API

`vite-plugin-electron`'s JavaScript APIs are fully typed, and it's recommended to use TypeScript or enable JS type checking in VS Code to leverage the intellisense and validation.

- `ElectronOptions` - type
- `resolveViteConfig` - function, Resolve the default Vite's `InlineConfig` for build Electron-Main
- `withExternalBuiltins` - function
- `build` - function
- `startup` - function

**Example**

```js
import { build, startup } from 'vite-plugin-electron'

const isDev = process.env.NODE_ENV === 'development'
const isProd = process.env.NODE_ENV === 'production'

build({
  entry: 'electron/main.ts',
  vite: {
    mode: process.env.NODE_ENV,
    build: {
      minify: isProd,
      watch: isDev ? {} : null,
    },
    plugins: [
      {
        name: 'plugin-start-electron',
        closeBundle() {
          if (isDev) {
            // Startup Electron App
            startup()
          }
        },
      },
    ],
  },
})
```

**Hot Reload**

Since `v0.29.0`, when preload scripts are rebuilt, they will send an `electron-vite&type=hot-reload` event to the main process.
If your App doesn't need a renderer process, this will give you **hot-reload**.

```js
// electron/main.ts

process.on('message', (msg) => {
  if (msg === 'electron-vite&type=hot-reload') {
    for (const win of BrowserWindow.getAllWindows()) {
      // Hot reload preload scripts
      win.webContents.reload()
    }
  }
})
```

## How to work

It just executes the `electron .` command in the Vite build completion hook and then starts or restarts the Electron App.

## Be aware

- 🚨 By default, the files in `electron` folder will be built into the `dist-electron`

## C/C++ Native

We have two ways to use C/C++ native modules

**First way**

In general, Vite may not correctly build Node.js packages, especially C/C++ native modules, but Vite can load them as external packages

So, put your Node.js package in `dependencies`. Unless you know how to properly build them with Vite

```js
export default {
  plugins: [
    electron({
      entry: 'electron/main.ts',
      vite: {
        build: {
          rolldownOptions: {
            // Here are some C/C++ modules them can't be built properly
            external: ['serialport', 'sqlite3'],
          },
        },
      },
    }),
  ],
}
```

**Second way**

Use 👉 [vite-plugin-native](https://github.com/vite-plugin/vite-plugin-native)

```js
import native from 'vite-plugin-native'

export default {
  plugins: [
    electron({
      entry: 'electron/main.ts',
      vite: {
        plugins: [native(/* options */)],
      },
    }),
  ],
}
```

<!-- You can see 👉 [dependencies vs devDependencies](https://github.com/electron-vite/vite-plugin-electron-renderer#dependencies-vs-devdependencies) -->

<!--

## Not Bundle

> Added in: v0.13.0 | Experimental

During the development phase, we can exclude the `cjs` format of npm-pkg from bundle. Like Vite's [👉 Not Bundle](https://vitejs.dev/guide/why.html#why-not-bundle-with-esbuild). **It's fast**!

```js
import electron from 'vite-plugin-electron'
import { notBundle } from 'vite-plugin-electron/plugin'

export default defineConfig(({ command }) => ({
  plugins: [
    electron({
      entry: 'electron/main.ts',
      vite: {
        plugins: [
          command === 'serve' && notBundle(/* NotBundleOptions */),
        ],
      },
    }),
  ],
}))
```

**API**

`notBundle(/* NotBundleOptions */)`

```ts
export interface NotBundleOptions {
  filter?: (id: string) => void | false
}
```

**How to work**

Let's use the `electron-log` as an examples.

```js
┏—————————————————————————————————————┓
│ import log from 'electron-log'      │
┗—————————————————————————————————————┛
                   ↓
Modules in `node_modules` are not bundled during development, it's fast!
                   ↓
┏—————————————————————————————————————┓
│ const log = require('electron-log') │
┗—————————————————————————————————————┛
```
->
