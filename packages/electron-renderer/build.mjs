import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { transform } from 'esbuild';
import { COLOURS } from 'vite-plugin-utils/function';

const iswatch = process.argv.slice(2).includes('--watch');
const CJS = {
  __filename: fileURLToPath(import.meta.url),
  __dirname: path.dirname(fileURLToPath(import.meta.url)),
  require: createRequire(import.meta.url),
};
const entries = [
  'src/build-config.ts',
  'src/index.ts',
  'src/cjs-shim.ts',
  'src/use-node.js.ts',
  'src/optimizer.ts',
].map(file => path.join(CJS.__dirname, file));
const PATHNAME = {
  src: 'src',
  dist: 'plugins',
};

function ensureDir(filename) {
  const dir = path.dirname(filename)
  !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true })
  return filename
}

/**
 * @param {import('esbuild').TransformOptions} options 
 * @param {string | string[]} files 
 */
async function transpile(options, files = entries) {
  for (const file of [].concat(files)) {
    const code = fs.readFileSync(file, 'utf8');
    const result = await transform(code, {
      loader: 'ts',
      target: 'node14',
      ...options,
    });

    if (options.format === 'cjs') {
      // https://github.com/evanw/esbuild/issues/2441
      result.code = result.code.replace(
        'const import_meta = {}',
        'const import_meta = { url: "file:" + __filename }',
      );
    }

    const distname = file
      .replace(PATHNAME.src, PATHNAME.dist)
      .replace('.ts', options.format === 'esm' ? '.mjs' : '.js');
    fs.writeFileSync(ensureDir(distname), result.code);

    console.log(
      COLOURS.cyan('[write]'),
      COLOURS.gary(new Date().toLocaleTimeString()),
      `${distname.replace(CJS.__dirname, '')}`,
    );
  }
}

// For cjs
function requireCjs(filename) {
  const requireRE = /require\(("(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)+')\)/g;
  const startOffset = 'require('.length;
  /** @type {{ start: number; end: number; raw: string; }[]} */
  const nodes = [];
  let match;
  let code = fs.readFileSync(filename, 'utf8');
  while (match = requireRE.exec(code)) {
    const [, rawId] = match;
    const start = match.index + startOffset;
    const end = start + rawId.length;
    nodes.unshift({ start, end, raw: rawId });
  }
  for (const node of nodes) {
    const { start, end, raw } = node;
    const id = raw.slice(1, -1);
    const idWithExt = id + '.js';
    if (!id.startsWith('.')) continue; // Only relative path
    if (!fs.existsSync(path.join(path.dirname(filename), idWithExt))) continue;
    code = code.slice(0, start) + raw.replace(id, idWithExt) + code.slice(end);
  }
  fs.writeFileSync(filename, code);
  console.log(
    COLOURS.yellow('[rewrite]'),
    COLOURS.gary(new Date().toLocaleTimeString()),
    filename.replace(CJS.__dirname, ''),
  );
}

// For mjs
function importEsm(filename) {
  const importRE = /import[\s\S]*?from\s*?(".+")/g;
  /** @type {{ start: number; end: number; raw: string; }[]} */
  const nodes = [];
  let match;
  let code = fs.readFileSync(filename, 'utf8');
  while (match = importRE.exec(code)) {
    const [statement, rawId] = match;
    const start = match.index + statement.replace(rawId, '').length;
    const end = start + rawId.length;
    nodes.unshift({ start, end, raw: rawId });
  }
  for (const node of nodes) {
    const { start, end, raw } = node;
    const id = raw.slice(1, -1);
    const idWithExt = id + '.mjs';
    if (!id.startsWith('.')) continue; // Only relative path
    if (!fs.existsSync(path.join(path.dirname(filename), idWithExt))) continue;
    code = code.slice(0, start) + raw.replace(id, idWithExt) + code.slice(end);
  }
  fs.writeFileSync(filename, code);
  console.log(
    COLOURS.yellow('[rewrite]'),
    COLOURS.gary(new Date().toLocaleTimeString()),
    filename.replace(CJS.__dirname, ''),
  );
}

function rewriteExtension() {
  const names = ['index']
  for (const name of names) {
    const cjs = path.join(CJS.__dirname, 'plugins', `${name}.js`);
    const esm = path.join(CJS.__dirname, 'plugins', `${name}.mjs`);
    requireCjs(cjs);
    importEsm(esm);
  }
}

function generateTypes() {
  return new Promise(resolve => {
    const cp = spawn(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'types'],
    );
    cp.on('exit', code => {
      console.log(COLOURS.cyan('[types]'), 'declaration generated');
      resolve(code);
    });
  });
}

fs.rmSync(path.join(CJS.__dirname, PATHNAME.dist), { recursive: true, force: true });
await transpile({ format: 'cjs' });
await transpile({ format: 'esm' });
rewriteExtension();
await generateTypes();

if (iswatch) {
  for (const [, entry] of entries.entries()) {
    const watcher = fs.watch(entry);
    watcher.on('change', async (_event, filename) => {
      const file = entries.find(e => e.includes(filename));
      await transpile({ format: 'cjs' }, file);
      await transpile({ format: 'esm' }, file);
      rewriteExtension();
      await generateTypes();
    });
  }
  console.log(COLOURS.yellow('[watch]'), 'waiting for file changes');
} else {
  console.log(COLOURS.green('[build]'), 'success');
}
