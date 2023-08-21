import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'
import pkg from './package.json'

const isdev = process.argv.slice(2).includes('--watch')
const istest = process.env.NODE_ENV === 'test'

export default defineConfig(() => {
  if (!isdev && !istest) {
    for (const dir of ['dist', 'plugin']) {
      fs.rmSync(path.join(__dirname, dir), { recursive: true, force: true })
    }
  }

  return {
    build: {
      minify: false,
      emptyOutDir: false,
      outDir: '',
      lib: {
        entry: {
          'dist/index': 'src/index.ts',
          'plugin/index': 'src/plugin.ts',
        },
        formats: ['cjs', 'es'],
        fileName: format => format === 'es' ? '[name].mjs' : '[name].js',
      },
      rollupOptions: {
        external: [
          'electron',
          'vite',
          ...builtinModules,
          ...builtinModules.map(m => `node:${m}`),
          ...Object.keys('dependencies' in pkg ? pkg.dependencies as object : {}),
        ],
        output: {
          exports: 'named',
        },
      },
    },
    plugins: [{
      name: 'generate-types',
      async closeBundle() {
        if (istest) return

        removeTypes()
        await generateTypes()
        moveTypesToDist()
        removeTypes()
      },
    }],
  }
})

function removeTypes() {
  fs.rmSync(path.join(__dirname, 'types'), { recursive: true, force: true })
}

function generateTypes() {
  return new Promise(resolve => {
    const cp = spawn(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'types'],
      { stdio: 'inherit' },
    )
    cp.on('exit', code => {
      !code && console.log('[types]', 'declaration generated')
      resolve(code)
    })
    cp.on('error', process.exit)
  })
}

function moveTypesToDist() {
  const types = path.join(__dirname, 'types')
  const dist = path.join(__dirname, 'dist')
  const plugin = path.join(__dirname, 'plugin')
  const files = fs.readdirSync(types).filter(n => n.endsWith('.d.ts'))
  for (const file of files) {
    const from = path.join(types, file)
    const to = file.includes('plugin.d.ts')
      ? path.join(plugin, 'index.d.ts')
      : path.join(dist, file)
    fs.writeFileSync(to, fs.readFileSync(from, 'utf8'))

    const cwd = process.cwd()
    console.log('[types]', `${path.relative(cwd, from)} -> ${path.relative(cwd, to)}`)
  }
}
