# Playground

This folder holds five separate demo packages that import the plugin source from the repo root.

## Install

Install once from the repo root so pnpm can resolve the workspace packages:

```sh
pnpm install
```

If you want to work on a single demo package directly, you can also run installs from inside each package folder:

```sh
pnpm --dir playground/flat install
pnpm --dir playground/multi-env install
pnpm --dir playground/simple install
pnpm --dir playground/worker install
pnpm --dir playground/shutdown install
```

## Run Flat Demo

The flat demo lives in `playground/flat/` and uses `playground/flat/vite.config.ts` to import [src/index.ts](../src/index.ts).

From the repo root:

```sh
pnpm play
pnpm play:build
```

Or from inside `playground/flat/`:

```sh
pnpm dev
pnpm build
```

## Run Multi-Env Demo

The multi-env demo lives in `playground/multi-env/` and uses `playground/multi-env/vite.config.ts` to import [src/multi-env.ts](../src/multi-env.ts). It configures named Electron environments through `simpleOptions()` for `main` and `preload`, and builds both `electron/main.ts` and `electron/worker.ts` as main-process entries.

From the repo root:

```sh
pnpm play:multi-env
pnpm play:build:multi-env
```

Or from inside `playground/multi-env/`:

```sh
pnpm dev
pnpm build
```

## Run Simple Demo

The simple demo lives in `playground/simple/` and uses `playground/simple/vite.config.ts` to import [src/simple.ts](../src/simple.ts).

From the repo root:

```sh
pnpm play:simple
pnpm play:build:simple
```

Or from inside `playground/simple/`:

```sh
pnpm dev
pnpm build
```

## Run Worker Demo

The worker demo lives in `playground/worker/` and uses `playground/worker/vite.config.ts` to import [src/index.ts](../src/index.ts). It verifies the flat API with multiple Electron entries.

From the repo root:

```sh
pnpm play:worker
pnpm play:build:worker
```

Or from inside `playground/worker/`:

```sh
pnpm dev
pnpm build
```

## Run Shutdown Regression

The shutdown playground lives in `playground/shutdown/` and uses `playground/shutdown/vite.config.ts` to import [src/index.ts](../src/index.ts). Its regression suite is [test/shutdown.test.ts](../test/shutdown.test.ts) (fixtures in `test/fixtures/shutdown/`), which covers process-lifetime behavior around `startup.exit()`:

**Fixed / asserted healthy**

- With `startup.treeKill`, leftover helpers are reaped after plugin-initiated shutdown (including SIGKILL escalation and `exitElectron(SIGTERM)`); without it, only the direct Electron child is signaled and helpers are left to the app
- A second Ctrl+C kills Electron and exits immediately (like the OS default for SIGINT)
- A programmatic `createServer()` host keeps its own SIGINT listener and still waits for Electron
- A failed `close()` / `startup.exit()` can be retried
- Two plugin sessions keep separate Electron children (`process.electronApp` is the latest alias)
- `startup.exit()` after the child is already gone resolves immediately
- Concurrent `startup.exit()` calls share one in-flight promise
- Natural Electron exit (`app.quit()` / `process.exit()`) closes Vite and exits the Vite CLI host
- With `startup.treeKill = true` (enabled in this playground's `vite.config.ts`), quitting kills the helper, so Electron, the helper and Vite all exit (real Electron test; skipped on Linux without `DISPLAY`)

**Documented intentional / platform notes**

- Natural Electron exit in `server.middlewareMode` closes Vite without `process.exit()` (the middleware host owns process lifetime)
- Without `startup.treeKill`, Windows Electron hangs after quitting while the helper runs (`SHUTDOWN_TREE_KILL=0` reproduces it)
- Watcher/mock cleanup runs before the kill signal
- Host `SIGKILL` can leave Electron/helper orphans (OS limitation)
- Windows `child.kill('SIGINT')` is `TerminateProcess` (skipped on non-Windows)

From the repo root:

```sh
pnpm play:shutdown
pnpm test test/shutdown.test.ts
```

Or run the playground from inside `playground/shutdown/` with `pnpm dev`.

Interactive env vars:

- `SHUTDOWN_SCENARIO=descendants|natural-exit|natural-process-exit|ignore-signals|two-plugins`
- `SHUTDOWN_TREE_KILL=0` disables `startup.treeKill` to show the unhandled hang
- `SHUTDOWN_WATCHER_DELAY_MS=2000` delays the Electron watcher close so the late kill is visible in logs
- `SHUTDOWN_TWO_PLUGINS=1` mounts a second `electron()` plugin
- `SHUTDOWN_HEADLESS=1` skips the BrowserWindow

`test/shutdown.test.ts` drives those cases against the plugin source and prints `[ok]` (or `[skipped]` for Windows-only SIGINT semantics on non-Windows hosts).

## What Each Demo Covers

- `flat/` exercises the flat API with `onstart`, full app restart behavior, and array-based Electron entries.
- `multi-env/` exercises `vite-plugin-electron/multi-env` with named Vite environments, per-environment `define` values, preload reload behavior, and a worker thread entry.
- `simple/` exercises the simple API with preload rebuild hot reload behavior.
- `worker/` exercises multiple entries.
- `shutdown/` regression-tests Ctrl+C / child-process lifetime behavior after synchronizing Electron and Vite shutdown.
