## 0.10.2 (2022-10-24)

1. Remove Vite `3.2.0` | #90
2. ad9bb3c refactor(electron-renderer)!: remove `options.resolve()`, use 'lib-esm' for resolve Node.js modules and `electron` | vite-plugin-electron-renderer
3. b500039 feat(electron-renderer): support `optimizeDeps` for Electron-Renderer 🚀
4. f28e66b faet(outDir)!: `dist/electron` -> `dist/electron` | vite-plugin-electron

## 0.10.1 (2022-10-12)

- 59a24df fix(electron-renderer): use `createRequire()` instead of `import()` 🐞
- 11cd4c3 feat(electron): `onstart` provides `reload()`

## 0.10.0 (2022-10-09)

#### Break!

This is a redesigned version of the API<sub><sup>(Only 3 APIs)</sub></sup>. Not compatible with previous versions!

```ts
export type Configuration = {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry?: import('vite').LibraryOptions['entry']
  /**
   * Triggered when Vite is built.  
   * If passed this parameter will not automatically start Electron App.  
   * You can start Electron App through the `startup` function passed through the callback function.  
   */
  onstart?: (this: import('rollup').PluginContext, startup: (args?: string[]) => Promise<void>) => void
  vite?: import('vite').InlineConfig
}
```

In the past few weeks, some issues have been mentioned in many issues that cannot be solved amicably. So I refactored the API to avoid design flaws. But despite this, the new version will only be easier rather than harder.

For example, some common problems in the following issues.

#### Multiple entry files is not support #86

  Thanks to Vite@3.2.0's `lib.entry` supports multiple entries, which makes the configuration of the new version very simple. **So the `vite-plugin-electron@0.10.0` requires Vite at least `v3.2.0`**.

  **e.g.**

  ```ts
  import electron from 'vite-plugin-electron'

  // In plugins option
  electron({
    entry: [
      'electron/entry-1.ts',
      'electron/entry-2.ts',
    ],
  })

  // Or use configuration array
  electron([
    {
      entry: [
        'electron/entry-1.ts',
        'electron/entry-2.ts',
      ],
    },
    {
      entry: 'foo/bar.ts',
    },
  ])
  ```

#### require is not defined #48, #87

  `vite-plugin-electron-renderer` will change `output.format` to `cjs` format by default<sub><sup>(This is because currently Electron@21 only supports CommonJs)</sub></sup>, which will cause the built code to use `require` to import modules, if the user `nodeIntegration` is not enabled in the Electron-Main process which causes the error `require is not defined` to be thrown.

  `vite-plugin-electron-renderer@0.10.0` provides the `nodeIntegration` option. It is up to the user to decide whether to use Node.js(CommonJs).

  **e.g.**

  ```ts
  import renderer from 'vite-plugin-electron-renderer'

  // In plugins option
  renderer({
    nodeIntegration: true,
  })
  ```

#### Use `Worker` in Electron-Main or Electron-Renderer #77, #81

> You can see 👉 [examples/worker](https://github.com/caoxiemeihao/vite-plugin-electron/tree/main/examples/worker)

- Use Worker in Electron-Main

  **e.g.** <sub><sup>This looks the same as multiple entry</sub></sup>

  ```ts
  import electron from 'vite-plugin-electron'

  // In plugins option
  electron({
    entry: [
      'electron/main.ts',
      'electron/worker.ts',
    ],
  })

  // In electron/main.ts
  new Worker(path.join(__dirname, './worker.js'))
  ```

- Use Worker in Electron-Renderer

  **e.g.**

  ```ts
  import renderer, { worker } from 'vite-plugin-electron-renderer'

  export default {
    plugins: [
      renderer({
        // If you need use Node.js in Electron-Renderer process
        nodeIntegration: true,
      }),
    ],
    worker: {
      plugins: [
        worker({
          // If you need use Node.js in Worker
          nodeIntegrationInWorker: true,
        }),
      ],
    },
  }
  ```

#### TODO

- [ ] There is no way to differentiate between Preload-Scripts, which will cause the entire Electron App to restart after the preload update, not the Electron-Renderer reload.

#### PR

https://github.com/electron-vite/vite-plugin-electron/pull/89

## 0.9.3 (2022-09-10)

~~*vite-plugin-electron*~~

*vite-plugin-electron-renderer*

- 191afb8 feat: proxy `ipcRenderer` in `Worker` | #69

## 0.9.2 (2022-08-29)

*vite-plugin-electron*

- 715a1cd fix(electron): `VITE_DEV_SERVER_HOSTNAME` instead `VITE_DEV_SERVER_HOST`

*vite-plugin-electron-renderer*

## 0.9.1 (2022-08-24)

*vite-plugin-electron*

- db61e49 feat(electron): support custom start 🌱 | #57, #58

~~*vite-plugin-electron-renderer*~~

## 0.9.0 (2022-08-12)

🎉 `v0.9.0` is a stable version based on `vite@3.0.6`

~~*vite-plugin-electron*~~

*vite-plugin-electron-renderer*

- ebc6a3d chore(electron-renderer): remove `renderBuiltUrl()` based on vite@3.0.6 ([vite@3.0.6-8f2065e](https://github.com/vitejs/vite/pull/9381/commits/8f2065efcb6ba664f7dce6f3c7666b29e2c56027#diff-aa53520bfd53e6c24220c44494457cc66370fd2bee513c15f9be7eb537a363e7L874))
