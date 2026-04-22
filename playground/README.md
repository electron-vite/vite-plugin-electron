# Playground

This folder holds two separate demo packages that import the plugin source from the repo root.

## Install

Install once from the repo root so pnpm can resolve the workspace packages:

```sh
pnpm install
```

If you want to work on a single demo package directly, you can also run installs from inside each package folder:

```sh
pnpm --dir playground/flat install
pnpm --dir playground/simple install
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

## What Each Demo Covers

- `flat/` exercises the flat API with `onstart`, full app restart behavior, and array-based Electron entries.
- `simple/` exercises the simple API with preload rebuild hot reload behavior.
