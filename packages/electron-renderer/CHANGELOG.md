
## [2022-07-11] v0.5.7

- 71799c7 fix(🐞): `cwd is not defined`

## [2022-07-11] v0.5.6

- d31f917 refactor: `root: string` instead of `config: UserConfig`

## [2022-07-11] v0.5.5

- 7f5117b chore: types
- 17eab4d fix(🐞): build Electron-Renderer
- f5ea26c remove `plugins/use-node.js/electron-renderer.js`

## [2022-07-10] v0.5.4

- 75b60c2 docs: v0.5.4
- 1b933d2 refactor(🌱): better logic

## [2022-07-07] v0.5.3

- 69eb531 docs: v0.5.3
- cc98ed9 feat: `ResolveModules['options']`  optional
- db03a72 chore: remove `useNodeJs.default = useNodeJs`
- c30dc1b fix(🐞): add `electron` to ` builtins

## [2022-07-07] v0.5.2

- 9dd8d4c feat: export `resolveModules()`
- 609e582 feat: interface `ResolveModules`
- dc6d6f6 docs: update
- 201eb71 docs: 🚨 ESM packages
- c8fe50b docs: `import { ipcRenderer } from 'electron'`

## [2022-07-01] v0.5.1

- ec224db refactor: optimize code
- f0efdfb fix(🐞): exclude ESM package
- f3e6b2c chore: optimize code
- 66df43b docs: update
- e2afb1e docs: `Electron-Renderer(vite serve)` flow chart
- 329056f docs: `dependencies` vs `devDependencies`
- d9734c9 Update README.md

## [2022-06-28] v0.5.0

- 6f3d745 fix(🐞): `require('fs')`
- 53845da feat: `config.build.emptyOutDir=false`
- 7cf9deb electron-renderer.js -> plugins/use-node.js/electron-renderer.js
- 7d537d5 docs: v0.5.0
- 2966399 refactor: standalone plugins
- ac356f2 feat: `vite-plugin-electron-renderer:use-node.js`
- 9798acd feat: `vite-plugin-electron-renderer:polyfill-exports`
- 0948df9 feat: `vite-plugin-electron-renderer:build-config`
- 9fb0e03 docs: update
- b6ec453 Update README.md
- 32acf9a docs: update
- d277390 docs: update

## [2022-06-27] v0.4.1

- a7a41a4 docs: v0.4.1
- 62b7584 feat: try resolve `package.json` from `process.cwd()`

## [2022-06-26] v0.4.0

- 87da81f docs: v0.4.0
- f2b860b remove README.zh-CN.md
- 130dce3 refactor: `resolve()` instead of `dependencies`
- 4a2620d refactor: from v0.3.3
