# vite-plugin-electron

[English](https://github.com/electron-vite/vite-plugin-electron/tree/main#readme) | 简体中文

简而言之，`vite-plugin-electron` 让开发 Electron 应用和普通 Vite 项目一样简单。

> [!important]
> 本插件同时支持 Vite 7 和 Vite 8。
> 构建配置会自动适配：Vite 8+ 使用 `rolldownOptions`，Vite < 8 使用 `rollupOptions`。

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
        // Shortcut of `build.rolldownOptions.input` (`build.rollupOptions.input` on Vite < 8)
        input: 'electron/preload.ts',
      },
      // Optional: Use Node.js API in the Renderer process
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
   * However, you can start Electron App via `startup` function.
   */
  onstart?: (args: {
    /**
     * Electron App startup function.
     * It will mount the Electron App child-process to `process.electronApp`.
     *
     * You can also set environment variables to control the Electron CLI flags.
     * Supported env vars:
     * - `REMOTE_DEBUGGING_PORT`
     * - `ELECTRON_IGNORE_CERTIFICATE_ERRORS`
     * - `ELECTRON_DISABLE_WEB_SECURITY`
     * - `ELECTRON_INSPECT`
     * - `ELECTRON_INSPECT_BRK`
     *
     * `1` or `true` turns a flag on, `0` or `false` turns it off, and any other non-empty
     * value is appended as `=<value>`.
     *
     * @param argv default value `['.', '--no-sandbox']`
     * @param options options for `child_process.spawn`
     * @param customElectronPkg custom electron package name (default: 'electron')
     * @returns `true` if the Electron app is started, or `false` if the startup is prevented by `startup.prevent` or `ELECTRON_STARTUP_PREVENT` env var.
     */
    startup: (
      argv?: string[],
      options?: import('node:child_process').SpawnOptions,
      customElectronPkg?: string,
    ) => Promise<boolean>
    /** Reload Electron-Renderer */
    reload: () => void
  }) => void | Promise<void>
}
```

## Environment API

> [!important]
> `vite-plugin-electron/multi-env` 仅在 `vite-plugin-electron@>=1.0.0` 提供。
> `0.x` 版本没有此功能。

使用 Vite 的 Environment API 构建 Electron 目标，而不是手动调用 `build()`。这是未来主推的多目标构建方式，配置更简洁、易维护：Vite 8+ 用 `rolldownOptions.input`，Vite < 8 用 `rollupOptions.input`，为每个目标指定入口和可覆盖的环境配置。

Flat API：

```js
import electron from 'vite-plugin-electron/multi-env'

export default {
  plugins: [
    electron([
      {
        input: 'electron/main.ts',
      },
      {
        input: 'electron/preload.ts',
      },
    ]),
  ],
}
```

Simple API:

```js
import { electronSimple } from 'vite-plugin-electron/multi-env'

export default {
  plugins: [
    electronSimple({
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
        options: {
          define: {
            __ELECTRON_TARGET__: JSON.stringify('preload'),
          },
        },
      },
      // 你也可以添加自定义目标。它们会像主进程一样构建，但可以使用不同的环境变量。
      custom: {
        input: 'electron/custom.ts',
        options: {
          define: {
            __ELECTRON_TARGET__: JSON.stringify('custom'),
          },
        },
      },
    }),
  ],
}
```

`electronSimple()` 接受一个以环境名分组的对象。`main` 和 `preload` 会复用 simple API 的默认预设，其他自定义 key 会像主进程一样构建，并使用各自的环境配置。

### 类型定义

```ts
export interface MultiEnvElectronOptions {
  /**
   * Optional name for the Electron environment `electron_${name}`.
   *
   * By default, the plugin will generate environment names like `electron_0`,
   * `electron_1`, etc. based on the order of the options provided.
   */
  name?: string
  /**
   * Shortcut of `options.build.rolldownOptions.input` (`options.build.rollupOptions.input` on Vite < 8)
   */
  input?: import('vite').BuildEnvironmentOptions['rolldownOptions']['input']
  /**
   * Shortcut of `options.build.rolldownOptions.plugins` (`options.build.rollupOptions.plugins` on Vite < 8)
   */
  plugins?: import('vite').BuildEnvironmentOptions['rolldownOptions']['plugins']
  /**
   * Per-environment Vite options.
   */
  options?: import('vite').EnvironmentOptions
  onstart?: ElectronOptions['onstart']
}
```

## 热重载预加载脚本

从 `v0.29.0` 开始，当 preload 脚本重新构建时，它们会向主进程发送一个 `electron-vite&type=hot-reload` 事件。
如果你的应用不需要渲染进程，这就可以实现 **热重载**。

```js
// electron/main.ts

process.on('message', (msg) => {
  if (msg === 'electron-vite&type=hot-reload') {
    for (const win of BrowserWindow.getAllWindows()) {
      // 热重载 preload 脚本
      win.webContents.reload()
    }
  }
})
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

本地演示套件位于 [playground/](playground/README.md)，包含 flat、simple、multi-env 和 worker 模式，它们会直接从这个仓库导入插件源码。

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

### 自定义 Electron 包解析

`startup(argv, options, customElectronPkg)` 支持自定义 Electron fork。插件会优先在应用根目录上下文中解析该包（`process.cwd()`、`options.cwd`、`INIT_CWD`），然后再回退到标准模块解析。

如果仍然无法解析，`startup()` 会抛出错误，并提示安装方式或显式传入包名。

### 启动环境变量

> [!important]
> 环境变量 仅在 `vite-plugin-electron@>=1.0.0` 提供。
> `0.x` 版本没有此功能。

`startup()` 会读取这些环境变量。`1` 或 `true` 表示开启，`0` 或 `false` 表示关闭，其它非空值会追加为 `=<value>`。

- `REMOTE_DEBUGGING_PORT` 追加 `--remote-debugging-port=<value>`
- `ELECTRON_IGNORE_CERTIFICATE_ERRORS` 追加 `--ignore-certificate-errors`
- `ELECTRON_DISABLE_WEB_SECURITY` 追加 `--disable-web-security`
- `ELECTRON_INSPECT` 追加 `--inspect` 或 `--inspect=<value>`
- `ELECTRON_INSPECT_BRK` 追加 `--inspect-brk` 或 `--inspect-brk=<value>`

### 启动控制

> [!important]
> 启动控制 仅在 `vite-plugin-electron@>=1.0.0` 提供。
> `0.x` 版本没有此功能。

可以使用 `startup.prevent = true`, `ELECTRON_STARTUP_PREVENT=1`, 或 `ELECTRON_STARTUP_PREVENT=true` 在开发期间禁用自动启动。这样你可以按自己的时机手动调用 `startup.prevent = false; startup()`（例如先等待某个本地服务就绪）。

Await `startup()` 的返回值可以知道是否触发了启动，或者被控制选项阻止了。

## 内置插件

### notBundle 插件

使用 `notBundle()` 为 Electron 入口外部化依赖项。

这通过在运行 `vite serve` 时跳过依赖打包，可以让启动速度更快。生产构建中，它仍然会外部化依赖，但默认集合更窄。

> [!important]
> **`v1.0.0` 行为变更**：
>
> - `notBundle()` 现在会在 config 阶段根据 `package.json` 一次性配置 `build.rolldownOptions.external`（Vite < 8 为 `build.rollupOptions.external`），不再在每次 `resolveId` 时校验每个 import 是否可被 `require()` 加载。
> - `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies` 中列出的包都会被无条件外部化。如果某个包在运行时缺失，错误会在运行时抛出，而不会被默默打包进来。可以使用 `filter` 选项收窄或覆盖外部化范围。
> - 默认 external 集合在开发阶段更宽：`dependencies`、`devDependencies`、`peerDependencies` 和 `optionalDependencies` 都会被外部化；生产阶段只外部化 `dependencies`。可以使用 `filter` 显式覆盖集合。

```js
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import { notBundle } from 'vite-plugin-electron/plugin'

export default defineConfig({
  plugins: [
    electron({
      entry: 'electron/main.ts',
      vite: {
        plugins: [notBundle()],
      },
    }),
  ],
})
```

**原理说明**

在 Vite 8+ 使用 `build.rolldownOptions.external`，Vite < 8 使用 `build.rollupOptions.external`，自动外部化 package.json 里的依赖。

**API**

`notBundle(options?: NotBundleOptions)`

```ts
export interface NotBundleOptions {
  /**
   * 手动覆盖 `build.rolldownOptions.external`（Vite < 8 为 `build.rollupOptions.external`）。
   *
   * 如果未提供，开发阶段会 externalize package.json 中的 dependencies、devDependencies、peerDependencies、optionalDependencies。
   * 生产阶段只 externalize dependencies。
   *
   * 使用 `import { getIsViteDev } from 'vite-plugin-electron/plugin'` 检测是否为开发阶段。
   */
  filter?: RolldownOrRollupOptions['external']
}
```

#### API: extractExternalDeps

默认的外部化依赖逻辑。
- 开发阶段 externalize 所有 dependencies、devDependencies、peerDependencies、optionalDependencies。
- 生产阶段只 externalize dependencies。

```ts
/**
 * @param pkg package.json 的内容
 */
export function extractExternalDeps(pkg: Record<string, any>): RolldownOrRollupOptions['external']
```

### esmShim 插件

使用 `esmShim()` 为依赖这些 CJS 全局变量的 ESM Electron 入口注入 `__dirname` 和 `__filename` 的 shim。

只有实际引用了 `__dirname` 或 `__filename` 的文件才会被转换，因此对不需要它的文件没有额外开销。

```js
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import { esmShim, notBundle } from 'vite-plugin-electron/plugin'

export default defineConfig({
  plugins: [
    electron({
      entry: 'electron/main.ts',
      vite: {
        plugins: [notBundle(), esmShim()],
      },
    }),
  ],
})
```

**原理说明**

对于每个实际引用 `__dirname` 或 `__filename` 的文件，会在头部插入如下 shim：

```js
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
```

**API**

`esmShim()` —— 无需配置，直接加入 `plugins` 即可。

## 工作原理

插件会在 Vite 构建完成的钩子里执行 `electron .` 命令，然后启动或重启 Electron App。

## 注意事项

- 🚨 默认情况下，`electron` 文件夹下的文件会被构建到 `dist-electron` 目录

## C/C++ 原生模块

我们有两种方式使用 C/C++ 原生模块：

**第一种方式**

通常 Vite 不能正确构建 Node.js 包，尤其是 C/C++ 原生模块，但可以将它们作为外部依赖加载。

因此，请将你的 Node.js 包放到 `dependencies`，除非你非常清楚如何用 Vite 正确构建它们。

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

<!-- You can see 👉 [dependencies vs devDependencies](https://github.com/electron-vite/vite-plugin-electron-renderer#dependencies-vs-devdependencies) -->
