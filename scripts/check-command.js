
// /usr/local/lib/node_modules/npm/bin/npm-cli.js
// /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs
if (!process.env.npm_execpath.includes('pnpm')) {
  console.error('🚨 Packages must be published using pnpm.')
  process.exit(1)
}
