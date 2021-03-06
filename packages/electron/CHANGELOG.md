
## [2022-07-21] v0.8.1

- 33b121a chore(deps): hoist `typescript`
- d3bd37a chore(electron): change import path

## [2022-07-19] v0.8.0

- 45f34d9 vite-plugin-electron@0.8.0
- daa1c52 docs: `vite-plugin-electron@0.8.0`
- e4e7ee0 chore: fix link
- d1d4c82 chroe: bump deps
- 581ef71 chore(deps): bump vite to 3.0.2
- 481368a chore: remove unused def
- 71d54c1 chore(🐞): update import path
- 3bae8e5 refactor: `checkPkgMain.buildElectronMainPlugin()`
- dba119d chore: format code
- 739e659 feat: use `checkPkgMain()`
- 192a8ca refactor: standlone `checkPkgMain` function
- aaa9030 chore: explicitly specify external modules
- 3eac722 chore: remove TODO
- c03abe9 feat: add `checkPkgMain()` plugin
- d8c0f8e chore: rename param
- 04c94dd feat: `checkPkgMain()`
- 7b9631a deps: add `rollup`
- cec6db6 deps(🐞): add rollup for import `InputOption`
- a4de86e monorepo: move `vite-plugin-electron` to `packages/electron`

## [2022-07-11] v0.7.5

- 1ed6e19 chore: bump vite-plugin-electron-renderer to v0.5.7

## [2022-07-11] v0.7.4

- c60fb17 chore: update params
- 13f0c70 chore: bump vite-plugin-electron-renderer to 0.5.6

## [2022-07-10] v0.7.3

- 2033256 chore: bump deps

## [2022-07-07] v0.7.2

- 8fb064e fix(🐞): bump vite-plugin-electron-renderer to 0.5.3
- 44006b2 chore: comments

## [2022-07-07] v0.7.1

- 42acf37 docs: update
- 6d878f7 refactor: use `resolveModules()`
- acf1751 chore: bump deps

## [2022-07-06] v0.7.0

- 661a146 docs: v0.7.0
- 8ee091d feat: support restart on `vite.config.ts` changed #24
- ca15795 add `electron-env.d.ts`
- 76863bb electron-env.d.ts
- 3fbef04 refactor: optimize code
- cc3c8c0 feat: `resolveBuildConfig()`
- 50c3afe feat: `resolveRuntime()`
- 1184dd3 `node.js.ts` -> `config.ts`

## [2022-07-01] v0.6.2

- 5779397 chore: bump vite-plugin-electron-renderer to 0.5.1
- 2a2f77d docs: `Put Node.js packages in dependencies`

## [2022-06-26] v0.6.1

- 5b736fa bump vite-plugin-electron-renderer to 0.5.0
- f70e030 fix(🐞): ensure always load into `buildConfig()`
- 73ae8f2 docs: update

## [2022-06-26] v0.6.0

- 5204eca docs: v0.6.0
- e885e54 feat: `withExternal()`
- dee6d6a feat: `CommonConfiguration`
- 55f9e11 node.js.ts
- 83d0b8d remove README.zh-CN.md
- 5f488b8 remove `polyfille-exports`
- e118fbd remove `renderer`
- 6e5761f refactor: integrate `vite-plugin-electron-renderer`
- 0e696ec add `vite-plugin-electron-renderer`
- 87bc5bb remove `vite-plugin-optimizer`

## [2022-06-25] v0.5.1

- ccf6b29 [feat: make prefix-only core module as external module](https://github.com/electron-vite/vite-plugin-electron/pull/22)

## [2022-06-24] v0.5.0

- 0c5155c chore: TODO
- 892940e fix app,getName() return error name

## [2022-06-14] v0.4.9

- abf460f chore: variable rename
- ceb559f chore: `build.cssCodeSplit=false`

## [2022-06-08] v0.4.8

- ab40088 fix(🐞): set `emptyOutDir=false` for prevent accidental deletion of files
- 7baafa0 break: set `electron` `build.outDir` value is `dist/electron` by default
- c13eb49 fix(🐞): assign default value `dist/electron/[process]` of `build.outDir`
  https://github.com/electron-vite/vite-plugin-electron/issues/10

## [2022-06-06] v0.4.7

- 1346707 refactor: better assign default `build.outDir`
- f489da1 chore: commnets
- 6db3bf3 fix: check `output` is Array

## [2022-06-04] v0.4.6

- 394cf6f feat: `config.build.emptyOutDir = false` by default
- 4a67688 feat(🐞): enabled `polyfill-exports` by default
