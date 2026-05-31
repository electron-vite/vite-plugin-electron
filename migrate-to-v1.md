# Migration Guide: vite-plugin-electron v0.x to v1

This guide is written for maintainers and coding agents upgrading an existing `vite-plugin-electron@0.x` project to v1.

Use the main README for current v1 behavior. Use this file only when migrating older projects.

## Agent Checklist

1. Inspect the project:
   - Search for `vite-plugin-electron`, `vite-plugin-electron/simple`, `vite-plugin-electron/plugin`, `notBundle`, `startup`, `rollupOptions`, `browserField`, `tree-kill`, and `electron-vite&type=hot-reload`.
   - Open `vite.config.*`, `package.json`, Electron main/preload entries, and packaging config.
2. Upgrade dependencies:
   - Upgrade `vite-plugin-electron` to v1.
   - Keep `vite-plugin-electron-renderer` installed only if the project uses the `renderer` option.
   - Use a Vite version supported by v1.
3. Update Vite build option names:
   - Vite 8+: prefer `build.rolldownOptions`.
   - Vite < 8: keep `build.rollupOptions`.
   - The plugin adapts its own defaults automatically, but user config should match the installed Vite version.
4. Review `notBundle()` usage:
   - Replace old `filter(id) { return false }` logic.
   - Confirm every externalized runtime package exists in the Electron runtime layout.
5. Review `startup()` usage:
   - Handle the new boolean return value if callers await `startup()`.
   - Do not assume the old process-tree waiting behavior from `startup.exit()`.
6. Build and test:
   - Run the app in dev mode.
   - Run production build.
   - Package the app if the project uses electron-builder or a similar packager.
   - Start the packaged app and verify native modules and externalized packages resolve.

## API and Import Changes

The flat and simple APIs still exist:

```ts
import electron from 'vite-plugin-electron'
import electronSimple from 'vite-plugin-electron/simple'
```

The plugin subpath still exposes built-in helpers:

```ts
import { notBundle, esmShim } from 'vite-plugin-electron/plugin'
```

The Environment API is new in v1:

```ts
import electron from 'vite-plugin-electron/multi-env'
import { electronSimple } from 'vite-plugin-electron/multi-env'
```

Use `multi-env` for Vite Environment API based multi-target builds. It is not a required replacement for the flat or simple APIs.

## Vite Options

v0.x projects usually configure Rollup through `build.rollupOptions`.

In v1:

- Vite 8+ reads `build.rolldownOptions`.
- Vite < 8 reads `build.rollupOptions`.
- `compatRollupOptions()` can help library or shared config code accept both shapes.

Before:

```ts
electron({
  entry: 'electron/main.ts',
  vite: {
    build: {
      rollupOptions: {
        external: ['sqlite3'],
      },
    },
  },
})
```

Vite 8+:

```ts
electron({
  entry: 'electron/main.ts',
  vite: {
    build: {
      rolldownOptions: {
        external: ['sqlite3'],
      },
    },
  },
})
```

## notBundle Migration

This is the most important migration point.

### v0.29.1 behavior

`notBundle()` was a `resolveId` helper. It externalized a dependency only when all of these were true:

- The import was a bare package import.
- The resolved file was inside `node_modules`.
- The import was not an alias.
- The package could be loaded with `require()` from the importer.
- `filter(resolvedId)` did not return `false`.

The old `filter` type was:

```ts
filter?: (resolvedId: string) => void | false
```

Returning `false` meant "do not externalize this resolved file".

### v1 behavior

`notBundle()` configures Vite's external option at config time.

Default behavior:

- Development externalizes `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies`.
- Production externalizes only `dependencies`.

The v1 `filter` type is Vite/Rollup/Rolldown `external`:

```ts
filter?: RolldownOrRollupOptions['external']
```

Providing `filter` replaces the default package.json-derived external set. It is not a narrow callback layered on top of the default set.

### Replace old filter code

Old v0.x code:

```ts
notBundle({
  filter(id) {
    return id.includes('node_modules/some-package') ? false : undefined
  },
})
```

v1 code with an explicit external function:

```ts
notBundle({
  filter(source) {
    return source !== 'some-package'
  },
})
```

v1 code with an explicit external list:

```ts
notBundle({
  filter: ['electron-store', 'serialport'],
})
```

### Runtime dependency rule

Externalized packages are not bundled into the Electron output. They must be present in the runtime dependency layout.

For production packaging:

- Put native modules that must be collected by the packager in `dependencies`.
- Keep buildable modules in `devDependencies` unless they must remain external at runtime.
- If you manually externalize a package from `devDependencies`, ensure your packager copies it into the final app.

## startup Migration

### Return value

In v0.x, `startup()` returned `Promise<void>`.

In v1, `startup()` returns `Promise<boolean>`:

- `true`: Electron was started.
- `false`: startup was prevented by `startup.prevent` or `ELECTRON_STARTUP_PREVENT`.

Before:

```ts
await startup()
```

After:

```ts
const started = await startup()
if (!started) {
  // Startup was intentionally prevented.
}
```

### Startup controls

v1 supports:

- `startup.prevent = true`
- `ELECTRON_STARTUP_PREVENT=1`
- `ELECTRON_STARTUP_PREVENT=true`

Use these when another local service must become ready before Electron starts.

### Electron package resolution

`startup(argv, options, customElectronPkg)` resolves Electron from:

- `process.cwd()`
- `options.cwd`
- `INIT_CWD`
- normal module resolution fallback

If you use a custom Electron package or fork, pass the package name explicitly.

### Process exit behavior

v0.x used a tree-kill style exit path and waited for the existing Electron process to exit.

v1 stops the current Electron child process before starting the next one, but callers should not rely on the old process-tree waiting behavior. If your workflow requires waiting for child processes to exit, implement that in your `onstart` hook or wrapper script.

## Hot Reload Preload Scripts

Preload rebuilds send this IPC message to the main process:

```txt
electron-vite&type=hot-reload
```

Keep this listener if the app relies on preload hot reload without a renderer process:

```ts
process.on('message', (msg) => {
  if (msg === 'electron-vite&type=hot-reload') {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.reload()
    }
  }
})
```

## ESM Main Process

v1 supports ESM-oriented defaults when the app has:

```json
{
  "type": "module"
}
```

If Electron entry code uses CommonJS globals in ESM output, add `esmShim()`:

```ts
import { esmShim } from 'vite-plugin-electron/plugin'

electron({
  entry: 'electron/main.ts',
  vite: {
    plugins: [esmShim()],
  },
})
```

## Validation Commands

Run the project-specific equivalents of:

```sh
pnpm run build
pnpm run test
pnpm run typecheck
```

Then verify runtime behavior:

```sh
pnpm dev
pnpm build
```

If the project packages Electron:

```sh
pnpm electron-builder
```

The exact package script may differ. Inspect `package.json` before running commands.

## Common Failure Modes

- `Cannot find module "<pkg>"` in the packaged app: a package was externalized but not included in the runtime dependency layout.
- Old `notBundle({ filter(id) { ... } })` no longer behaves as expected: rewrite it as Vite/Rollup/Rolldown `external`.
- Vite 8 ignores `rollupOptions`: move user build options to `rolldownOptions`.
- TypeScript cannot find `vite-plugin-electron-renderer`: install it if the project uses the `renderer` option.
- ESM output fails on `__dirname` or `__filename`: add `esmShim()`.
