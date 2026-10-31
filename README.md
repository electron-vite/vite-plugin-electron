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

> [!note]
> This plugin supports both Vite 7 and Vite 8.
> Build config keys are adapted automatically, using `rolldownOptions` on Vite 8+ and `rollupOptions` on Vite < 8.

Migrating from `0.x`? See [Migrate to v1](./migrate-to-v1.md) for full migration guide.

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
        // Shortcut of `build.rolldownOptions.input` (`build.rollupOptions.input` on Vite < 8)
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
+ "main": "dist-electron/main.js"
}
```

That's it! You can now use Electron in your Vite app ✨

## How to work

It just executes the `electron .` command in the Vite `closeBundle()` hook and then starts or restarts the Electron App.

- 🚨 By default, the files in `electron` folder will be built into the `dist-electron` directory

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

### Flat API vs Simple API

- Simple API is based on the Flat API
- Simple API includes some Preload scripts preset configs.
- Flat API provides some more general APIs, which you can use for secondary encapsulation, such as [nuxt-electron](https://github.com/caoxiemeihao/nuxt-electron).

### Types

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
> `vite-plugin-electron/multi-env` is only available in `vite-plugin-electron@>=1.0.0`.
> It does not exist in `0.x` releases.

Using Vite's Environment API to build Electron targets instead of manually calling `build()`. It is the future-facing way to handle multi-target builds, and the configuration is more concise and easier to maintain: use `rolldownOptions.input` on Vite 8+ or `rollupOptions.input` on Vite < 8 to specify the entry and overridable environment config for each target.

Flat API:

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
        bundleDeps: {
          dev: {
            // Bundle this dependency during development.
            include: ['some-cjs-dependency'],
          },
          build: {
            // Leave this dependency in node_modules in the production output.
            exclude: ['electron-updater'],
          },
        },
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
      // You can also add custom targets, and they will be built in the same way as the main process, but with different environment variables.
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

`electronSimple()` accepts an object grouped by environment name. The `main` and `preload` keys reuse the same default presets as `vite-plugin-electron/simple`, while custom keys are built like main-process targets with their own environment options.

### Factory Usage

If you need to resolve Electron targets dynamically, use `electronPluginFactory()`. The factory receives the resolved project `root` and `packageJson`, and it can return a single option, an array of options, or a Promise that resolves to either shape.

```js
import { electronPluginFactory } from 'vite-plugin-electron/multi-env'

export default {
  plugins: [
    electronPluginFactory(async ({ root, packageJson }) => {
      const isESM = packageJson?.type === 'module'

      return [
        {
          name: 'main',
          input: 'electron/main.ts',
          options: {
            define: {
              __APP_ROOT__: JSON.stringify(root),
            },
          },
        },
        {
          name: 'preload',
          input: 'electron/preload.ts',
          options: {
            build: {
              minify: !isESM,
            },
          },
        },
      ]
    }),
  ],
}
```

### Types

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
  /**
   * Controls how dependencies are bundled.
   *
   * - `'vite'` (default) keeps Vite's server-environment behavior.
   * - `'auto'` bundles all dependencies except package.json dependencies.
   * - `true` bundles all dependencies.
   * - `false` externalizes all dependencies.
   */
  bundleDeps?:
    | 'vite'
    | 'auto'
    | boolean
    | {
        both?: {
          include?: string | RegExp | (string | RegExp)[] | true
          exclude?: string[] | true
        }
        dev?: {
          include?: string | RegExp | (string | RegExp)[] | true
          exclude?: string[] | true
        }
        build?: {
          include?: string | RegExp | (string | RegExp)[] | true
          exclude?: string[] | true
        }
      }
  onstart?: ElectronOptions['onstart']
}

export interface ElectronFactoryContext {
  root: string
  packageJson?: PackageJson | null
  isDev: boolean
}

export type MultiEnvElectronOptionsFactory = (
  context: ElectronFactoryContext,
) =>
  | MultiEnvElectronOptions
  | MultiEnvElectronOptions[]
  | Promise<MultiEnvElectronOptions | MultiEnvElectronOptions[]>
```

## Hot Reload Preload Scripts

Since `v0.29.0`, when preload scripts are rebuilt, they send an `electron-vite&type=hot-reload` event to the main process.
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

The local demo suite lives in [playground/](playground/README.md) and includes flat, simple, multi-env, and worker modes that import the plugin source directly from this repo.

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

### Custom Electron Package Resolution

`startup(argv, options, customElectronPkg)` supports custom Electron forks. The package is resolved from app roots (`process.cwd()`, `options.cwd`, and `INIT_CWD`) before falling back to standard module resolution.

`startup.exit()` signals the Electron process started by vite-plugin-electron (SIGTERM by default, or an explicit signal) and returns a `Promise<void>` that resolves after that direct child exits (v1.1.x and earlier returned nothing). Await it or attach `.catch()`: it rejects when the signal cannot be sent, and an unhandled rejection crashes Node by default. If the direct child has not exited after 5 seconds, it is killed with `SIGKILL`. By default only the direct child is signaled; processes the app started are the app's responsibility (see [Killing the App's Child Processes on Exit](#killing-the-apps-child-processes-on-exit)). `SpawnOptions.killSignal` is spawn configuration, not the signal for later `startup.exit()` calls. Shutdown terminates OS processes, not through Electron's `app.quit()`, and does not promise application-level graceful quit hooks.

During development, Ctrl+C forwards `SIGINT` to Electron and waits for all pending dev sessions and their Electron children to shut down before exiting with code 130. This includes earlier sessions still closing during a restart (where the Vite CLI re-evaluates the config and creates new plugin instances) and every `electron()` plugin in the config, since all of them share one process-wide `SIGINT` handler. A second Ctrl+C behaves like the OS default: the plugin kills any Electron child still running with `SIGKILL` and exits with code 130 immediately. This applies to the Vite CLI and to programmatic `createServer()` hosts that are not in `server.middlewareMode`: your own `SIGINT` listeners still run, but the plugin ends the process with `process.exit(130)` once shutdown finishes. If your host needs its own asynchronous cleanup on Ctrl+C, use `server.middlewareMode` (the plugin then installs no `SIGINT` handler) and call `server.close()` yourself. Note that Vite creates no HTTP server in `server.middlewareMode`, and the plugin starts its dev work (setting `VITE_DEV_SERVER_URL` and launching Electron) only from the `listening` event of `server.httpServer`. In that mode the plugin therefore does not start Electron by itself: once your own HTTP server is listening, set `VITE_DEV_SERVER_URL` and call the exported `startup()` yourself. Programmatic `server.close()` uses `SIGTERM`. Each plugin session owns its Electron child; `process.electronApp` remains a compatibility alias for the latest/active child. Vite restarts isolate each server generation's watchers, mock files, and Electron child; cleanup from an earlier generation cannot shut down the new session.

Natural Electron exit closes the Vite server and then exits the development process with Electron's exit code, so leftover Vite CLI handles (such as the stdin shortcut reader) cannot keep it alive. In `server.middlewareMode`, the plugin only closes the Vite server and does not call `process.exit()`, so middleware hosts retain control of process lifetime. Piped stdio is unreferenced after the direct child exits, so pipes inherited by descendants do not keep the development process alive. If the host process exits by another path while Electron is still running, a synchronous `exit` hook kills the Electron child. Host `SIGKILL` cannot run plugin cleanup and may leave orphans (OS limitation). On Windows, `child.kill('SIGINT')` is `TerminateProcess` rather than a catchable Ctrl+C.

If the package cannot be resolved, `startup()` throws an error describing how to install or pass the package explicitly. When the plugin starts Electron itself (without `onstart`, from `reload()`, or when an `onstart` callback throws or rejects), such failures are logged through Vite's logger instead of crashing the dev server.

### Killing the App's Child Processes on Exit

If the Electron main process starts child processes (a local server, a worker binary, ...), those processes keep running after Electron quits. On Windows, Electron itself also stays alive after `app.quit()`, `app.exit()` or `process.exit()` while a process it started before its first window is still running, so the dev process never ends.

By default the plugin does not touch these processes, and the app must stop its own children before quitting (for example in `app.on('will-quit')`). Set `startup.treeKill = true` to let the plugin handle it during development:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import electron, { startup } from 'vite-plugin-electron'

startup.treeKill = true

export default defineConfig({
  plugins: [electron({ entry: 'electron/main.ts' })],
})
```

When enabled, each Electron app the plugin starts gets a small script preloaded into its main process via `NODE_OPTIONS=--require` (the user's own `NODE_OPTIONS` are kept). The script is written to `vite-plugin-electron/` inside Vite's resolved [`cacheDir`](https://vite.dev/config/shared-options#cachedir) (by default `node_modules/.vite` of the project), and rewritten if its content does not match. A `startup()` call outside the plugin uses the latest dev server's `cacheDir`, or `<cwd>/node_modules/.vite` when no dev server exists. The script is not kept in the shared temp directory, where another local user could replace it. When the Electron main process exits, the script synchronously kills every process the app started, including their descendants and detached processes, but not Chromium's own helper processes. It reads the process table with PowerShell on Windows and `ps` on macOS/Linux, which adds a short delay to exit (about 1 second on Windows). Processes the app starts see the original `NODE_OPTIONS`, so the script does not spread to them. It is not part of production builds, and does not run if Electron crashes or is killed from outside.

`startup.treeKill` also turns on descendant cleanup in the plugin itself:

- Shutdowns the plugin starts (restarts after a rebuild, `startup.exit()`, Ctrl+C, `server.close()`) list the Electron child's descendants before signaling it and kill any that are left after it exits. A PID is skipped if it now belongs to a process started after that list was taken. A `SIGKILL`, from the 5-second timeout, a second Ctrl+C, or the host-exit hook, kills the whole process tree.
- On Windows, when Electron exits by itself, processes whose parent was Electron (e.g. detached helpers) are killed with their descendants. POSIX re-parents orphans, so they cannot be found after a self-exit.

Windows keeps a dead parent's PID in `ParentProcessId` and reuses PIDs. On Windows, both the plugin and the preloaded script therefore count a process as a child only if it was created no earlier than its parent, and orphans only if they were created while Electron was running. They kill with `taskkill /F` per PID rather than `taskkill /T`, because `/T` follows stale parent ids.

These process-table scans are synchronous, so each restart and shutdown takes a little longer (about 1 second on Windows). Without `startup.treeKill`, the plugin never scans the process table and only signals the direct Electron child.

### Startup Env Vars

> [!important]
> Environment variables are only available in `vite-plugin-electron@>=1.0.0`.
> They do not exist in `0.x` releases.

`startup()` uses these env vars. `1` or `true` turns a flag on, `0` or `false` turns it off, and any other non-empty value is appended as `=<value>`.

- `REMOTE_DEBUGGING_PORT` appends `--remote-debugging-port=<value>`
- `ELECTRON_IGNORE_CERTIFICATE_ERRORS` appends `--ignore-certificate-errors`
- `ELECTRON_DISABLE_WEB_SECURITY` appends `--disable-web-security`
- `ELECTRON_INSPECT` appends `--inspect=<value>`
- `ELECTRON_INSPECT_BRK` appends `--inspect-brk=<value>`

### Startup Controls

> [!important]
> Startup controls are only available in `vite-plugin-electron@>=1.0.0`.
> They do not exist in `0.x` releases.

Use `startup.prevent = true`, `ELECTRON_STARTUP_PREVENT=1`, or `ELECTRON_STARTUP_PREVENT=true` to disable automatic electron app startup. This lets you decide when to call `startup.prevent = false; startup()` manually (for example, after waiting for another local service).

Await the return value of `startup()` to know if the startup was triggered or prevented by the controls.

## Builtin Plugins

### notBundle Plugin

Use `notBundle()` to externalize dependencies in Electron entries.

This keeps startup fast by skipping dependency bundling while running `vite serve`.
In production builds, it still externalizes dependencies, but it uses a narrower default set.

> [!tip]
> **Using `vite-plugin-electron/multi-env`?**
> Use `bundleDeps` instead of this plugin. It maps directly to Vite's Environment API:
>
> ```js
> import { electronSimple } from 'vite-plugin-electron/multi-env'
>
> electronSimple({
>   main: {
>     input: 'electron/main.ts',
>     bundleDeps: {
>       dev: { include: ['some-cjs-dependency'] },
>       build: { exclude: ['electron-updater'] },
>     },
>   },
> })
> ```
>
> `include` maps to `resolve.noExternal`, and `exclude` maps to `resolve.external`. When no
> `bundleDeps` policy is supplied, Vite's server-environment defaults apply. `both` is merged
> with the corresponding `dev` or `build` policy. Use `'auto'` to bundle all dependencies except
> the package.json dependencies selected by the standalone `notBundle()` plugin, `true` to bundle
> all dependencies, or `false` to externalize all dependencies.

> [!important]
> **Behavior change in `v1.0.0`**:
>
> - `notBundle()` now configures `build.rolldownOptions.external` (or `build.rollupOptions.external` on Vite < 8) from your `package.json` once at config time, instead of verifying each import is CommonJS-loadable on every `resolveId`.
> - Every package listed in `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies` is externalized unconditionally. If a package is missing at runtime, the failure now surfaces at runtime rather than being silently bundled. Use the `filter` option to narrow or override the externalized set.
> - The default external set is broader during development: `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies` are all externalized. In production, only `dependencies` are externalized. Use `filter` to override the set explicitly.

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

**Under the Hood**

Use `build.rolldownOptions.external` on Vite 8+ or `build.rollupOptions.external` on Vite < 8 to externalize dependencies from package.json

**API**

`notBundle(options?: NotBundleOptions)`

```ts
export interface NotBundleOptions {
  /**
   * Override `build.rolldownOptions.external` (`build.rollupOptions.external` on Vite < 8).
   *
   * When omitted, development externalizes dependencies, devDependencies,
   * peerDependencies, and optionalDependencies from package.json.
   * Production only externalizes dependencies.
   *
   * When provided, this replaces the default package.json-derived external set.
   *
   * Use `import { getIsViteDev } from 'vite-plugin-electron/plugin'` to detect if it's during dev.
   */
  filter?: RolldownOrRollupOptions['external']
}
```

#### API: extractExternalDeps

Default behavior of extracting external dependencies from package.json.

- During development, `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies` are externalized.
- During production, only `dependencies` are externalized.

```ts
/**
 * @param pkg package.json content
 */
export function extractExternalDeps(pkg: Record<string, any>): RolldownOrRollupOptions['external']
```

### esmShim Plugin

> [!important]
> `esmShim` plugin is only available in `vite-plugin-electron@>=1.0.0`.
> It does not exist in `0.x` releases.

Use `esmShim()` to inject `__dirname` and `__filename` shims for ESM Electron entries that rely on these CJS globals.

Only files that actually reference `__dirname` or `__filename` are transformed, so there is no overhead for files that don't need it.

```js
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import { esmShim } from 'vite-plugin-electron/plugin'

export default defineConfig({
  plugins: [
    electron({
      entry: 'electron/main.ts',
      vite: {
        plugins: [esmShim()],
      },
    }),
  ],
})
```

**Under the Hood**

For each matching file, the following shim is prepended:

```js
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
```

**API**

`esmShim()` — no options, just add it to `plugins`.

## dependencies vs devDependencies

[electron-builder](https://github.com/electron-userland/electron-builder) packages `dependencies` into the final app, and Vite/Rolldown may also bundle `dependencies` into the renderer output. To avoid shipping the same code twice, native modules should stay in `dependencies` by default because electron-builder needs to collect their binary files. Other buildable modules should stay in `devDependencies`; otherwise, they can be bundled by Vite and packaged again by electron-builder.

<table>
  <thead>
    <th>Classify</th>
    <th>e.g.</th>
    <th>dependencies</th>
    <th>devDependencies</th>
  </thead>
  <tbody>
    <tr>
      <td>Node.js C/C++ native modules</td>
      <td>serialport, sqlite3</td>
      <td>✅</td>
      <td>❌</td>
    </tr>
    <tr>
      <td>Node.js CJS packages</td>
      <td>electron-store</td>
      <td>❌</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>Node.js ESM packages</td>
      <td>execa, got, node-fetch</td>
      <td>❌</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>Web packages</td>
      <td>Vue, React</td>
      <td>❌</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

If you manually handle the binary files and runtime dependency layout for native modules, you can also move those native modules to `devDependencies` to further reduce the packaged app size.
