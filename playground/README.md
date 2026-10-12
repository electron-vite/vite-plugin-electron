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

## Run Shutdown Repro

The shutdown playground lives in `playground/shutdown/` and uses `playground/shutdown/vite.config.ts` to import [src/index.ts](../src/index.ts). It is a demo of the remaining process-lifetime gaps around `startup.exit()`: leftover descendants, SIGKILL of the direct child only, a second Ctrl+C dropping the plugin handler, Electron's natural exit skipping `process.exit()`, a failed close that cannot be retried, watcher cleanup running before the kill signal, two plugin instances sharing `process.electronApp`, host SIGKILL leaving Electron/helper orphans, `startup.exit()` after the child is already gone, concurrent `startup.exit()` sharing one promise, natural Electron exit leaving the Vite host event loop alive, and helpers surviving `exitElectron(SIGTERM)`.

From the repo root:

```sh
pnpm play:shutdown
pnpm play:shutdown:reproduce
```

Or from inside `playground/shutdown/`:

```sh
pnpm dev
pnpm reproduce
```

Interactive env vars:

- `SHUTDOWN_SCENARIO=descendants|natural-exit|ignore-signals|two-plugins`
- `SHUTDOWN_WATCHER_DELAY_MS=2000` delays the Electron watcher close so the late kill is visible in logs
- `SHUTDOWN_TWO_PLUGINS=1` mounts a second `electron()` plugin
- `SHUTDOWN_HEADLESS=1` skips the BrowserWindow

`pnpm reproduce` drives those cases against the plugin source and prints `[reproduced]` (or `[skipped]` for Windows-only SIGINT semantics on non-Windows hosts).

## What Each Demo Covers

- `flat/` exercises the flat API with `onstart`, full app restart behavior, and array-based Electron entries.
- `multi-env/` exercises `vite-plugin-electron/multi-env` with named Vite environments, per-environment `define` values, preload reload behavior, and a worker thread entry.
- `simple/` exercises the simple API with preload rebuild hot reload behavior.
- `worker/` exercises multiple entries.
- `shutdown/` reproduces Ctrl+C / child-process lifetime gaps that remain after synchronizing Electron and Vite shutdown.
