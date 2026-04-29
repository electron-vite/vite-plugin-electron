# vite-plugin-electron

[English](https://github.com/electron-vite/vite-plugin-electron/tree/main#readme) | 简体中文

简而言之，`vite-plugin-electron` 让开发 Electron 应用和普通 Vite 项目一样简单。

> [!important]
> 在即将到来的 `v1` 版本中，本项目将停止支持 `vite@<8`。
> 如需继续使用 Vite 7，请改用 `v0.29.1`。它已经稳定且可用于生产环境。

## 特性

- [🔥 热重启 <sub><sup>(主进程)</sup></sub>](https://electron-vite.github.io/guide/features.html#hot-restart)
- [🔄 热重载 <sub><sup>(预加载脚本)</sup></sub>](https://electron-vite.github.io/guide/features.html#hot-reload)
- [⚡️ HMR <sub><sup>(渲染进程)</sup></sub>](https://electron-vite.github.io/guide/features.html#hmr)
<!-- - [🚀 Not Bundle, It's fast <sub><sup>(Like Vite's Not Bundle)</sup></sub>](https://github.com/electron-vite/vite-plugin-electron#not-bundle) -->
- 🌱 与 Vite 及其生态完全兼容 <sub><sup>(基于 Vite)</sup></sub>
- 🔮 完整的 [JavaScript API](https://github.com/electron-vite/vite-plugin-electron#javascript-api)，很适合和复杂项目集成。
- 🐣 API 少，上手简单

<!-- ![vite-plugin-electron.gif](https://github.com/electron-vite/vite-plugin-electron/blob/main/vite-plugin-electron.gif?raw=true) -->

## 快速开始

1. 在项目中添加下面的依赖

```sh
npm i -D vite-plugin-electron
```

`renderer` 选项已经内置，不需要再额外安装渲染进程插件依赖。

2. 把 `vite-plugin-electron` 加到 `vite.config.ts` 的 `plugins` 配置里

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
        // Shortcut of `build.rolldownOptions.input`
        input: 'electron/preload.ts',
      },
      // Optional: Use the built-in Node.js/Electron renderer support
      renderer: {},
    }),
  ],
}
```

3. 创建 `electron/main.ts` 文件，并写入下面的代码

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

4. 在 `package.json` 中添加 `main` 入口

```diff
{
+ "main": "dist-electron/main.mjs"
}
```

就是这样！现在你可以在 Vite 应用里使用 Electron 了 ✨

## Flat API

大多数情况下，推荐使用 `vite-plugin-electron/simple` API。如果你很了解这个插件的工作方式，或者想把 `vite-plugin-electron` API 作为底层 API 的二次封装，那么 Flat API 会更适合你。它同样简单，但更灵活。:)

和 simple API 相比，它不会自动识别哪个入口代表 `preload`，也不会自动适配 preload。

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

- Simple API 基于 Flat API
- Simple API 包含一些 preload 脚本的预设配置。
- Flat API 提供了更通用的一些 API，你可以用它做二次封装，比如 [nuxt-electron](https://github.com/caoxiemeihao/nuxt-electron)。

## Flat API <sub><sup>(定义)</sup></sub>

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

## `/multi-env`

> [!important]
> `vite-plugin-electron/multi-env` 只在 `vite-plugin-electron@>=1.0.0` 中提供。
> `0.x` 版本没有这个入口。

当你希望每个 Electron 构建目标都映射到一个明确的 Vite environment 时，使用 `/multi-env` 会更直接。它使用 Vite 的 Environment API 来构建 Electron 目标，是更面向未来的多目标构建方式。

```js
import electron, { simpleOptions } from 'vite-plugin-electron/multi-env'

export default {
  plugins: [
    electron(
      simpleOptions({
        main: {
          input: 'electron/main.ts',
          options: {
            define: {
              __ELECTRON_TARGET__: JSON.stringify('main'),
            },
          },
        },
        preload: {
          input: 'electron/preload.ts',
          onstart({ reload }) {
            reload()
          },
          options: {
            define: {
              __ELECTRON_TARGET__: JSON.stringify('preload'),
            },
            build: {
              rolldownOptions: {
                output: {
                  format: 'cjs',
                  codeSplitting: false,
                },
              },
            },
          },
        },
      }),
    ),
  ],
}
```

`simpleOptions()` 可以把一个按环境名分组的对象转换成 `electron()` 需要的数组。`main` 和 `preload` 这两个 key 还会复用 `simple` API 的默认预设，这样你既能按 key 组织配置，又不会失去这些便利配置。

```ts
export interface MultiEnvElectronOptions {
  /**
   * Optional name for the Electron environment.
   *
   * By default, the plugin will generate environment names like `electron_0`,
   * `electron_1`, etc. based on the order of the options provided.
   */
  name?: string
  /**
   * Shortcut of `options.build.rolldownOptions.input`
   */
  input?: import('vite').BuildEnvironmentOptions['rolldownOptions']['input']
  /**
   * Shortcut of `options.build.rolldownOptions.plugins`
   */
  plugins?: import('vite').BuildEnvironmentOptions['rolldownOptions']['plugins']
  /**
   * Per-environment Vite options.
   */
  options?: import('vite').EnvironmentOptions
  onstart?: ElectronOptions['onstart']
}
```

## 推荐目录结构

下面以基于 `create vite` 的官方 [template-vanilla-ts](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-vanilla-ts) 模板为例。

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

## 构建格式

这只是默认行为；你可以随时通过 `vite.config.js` 里的自定义配置来修改。

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

## 示例

这里有很多示例 👉 [electron-vite-samples](https://github.com/caoxiemeihao/electron-vite-samples)

## Playground

本地演示套件位于 [playground/](playground/README.md)，包含 flat、simple 和 multi-env 三种模式，它们会直接从这个仓库导入插件源码。

## JavaScript API

`vite-plugin-electron` 的 JavaScript API 都有完整类型信息，建议使用 TypeScript，或者在 VS Code 中开启 JS 类型检查，以便使用智能提示和校验。

- `ElectronOptions` - 类型
- `resolveViteConfig` - 函数，用于解析构建 Electron Main 的默认 Vite `InlineConfig`
- `withExternalBuiltins` - 函数
- `build` - 函数
- `startup` - 函数

**示例**

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

**热重载**

从 `v0.29.0` 开始，当 preload 脚本重新构建时，它们会向主进程发送一个 `electron-vite&type=hot-reload` 事件。
如果你的应用不需要渲染进程，这就可以实现 **热重载**。

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

## 如何工作

它只是在 Vite 构建完成的 hook 里执行 `electron .` 命令，然后启动或重启 Electron App。

## 注意事项

- 🚨 默认情况下，`electron` 文件夹下的文件会被构建到 `dist-electron`

## C/C++ 原生模块

我们有两种使用 C/C++ 原生模块的方法。

**第一种方式**

通常来说，Vite 可能无法正确构建 Node.js 包，尤其是 C/C++ 原生模块；但 Vite 可以把它们作为外部包加载。

所以，请把你的 Node.js 包放到 `dependencies` 中，除非你知道如何正确地用 Vite 构建它们。

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

**第二种方式**

使用 👉 [vite-plugin-native](https://github.com/vite-plugin/vite-plugin-native)

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
-->
