import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { transform } from 'esbuild';

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
].map(file => path.join(CJS.__dirname, file));
const PATHNAME = {
  src: 'src',
  dist: 'plugins',
};
/**
 * @see https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
 * @see https://en.wikipedia.org/wiki/ANSI_escape_code#Colors
 */
const colours = {
  $_$: c => str => `\x1b[${c}m` + str + '\x1b[0m',
  gary: str => colours.$_$(90)(str),
  cyan: str => colours.$_$(36)(str),
  yellow: str => colours.$_$(33)(str),
  green: str => colours.$_$(32)(str),
  red: str => colours.$_$(31)(str),
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
        'const import_meta = {};',
        'const import_meta = { url: "file:" + __filename };',
      );
    }

    const distname = file
      .replace(PATHNAME.src, PATHNAME.dist)
      .replace('.ts', options.format === 'esm' ? '.mjs' : '.js');
    fs.writeFileSync(ensureDir(distname), result.code);

    console.log(
      colours.cyan('[write]'),
      colours.gary(new Date().toLocaleTimeString()),
      `${distname.replace(CJS.__dirname, '')}`,
    );
  }
}

function requireCjs(filename = path.join(CJS.__dirname, 'plugins/index.js')) {
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
    if (!fs.existsSync(path.join(path.dirname(filename), idWithExt))) continue;
    code = code.slice(0, start) + raw.replace(id, idWithExt) + code.slice(end);
  }
  fs.writeFileSync(filename, code);
  console.log(
    colours.yellow('[rewrite]'),
    colours.gary(new Date().toLocaleTimeString()),
    filename.replace(CJS.__dirname, ''),
  );
}

function importEsm(filename = path.join(CJS.__dirname, 'plugins/index.mjs')) {
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
    if (!fs.existsSync(path.join(path.dirname(filename), idWithExt))) continue;
    code = code.slice(0, start) + raw.replace(id, idWithExt) + code.slice(end);
  }
  fs.writeFileSync(filename, code);
  console.log(
    colours.yellow('[rewrite]'),
    colours.gary(new Date().toLocaleTimeString()),
    filename.replace(CJS.__dirname, ''),
  );
}

function generateTypes() {
  return new Promise(resolve => {
    const cp = spawn(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'types'],
    );
    cp.on('exit', code => {
      console.log(colours.cyan('[types]'), 'generated');
      resolve(code);
    });
  });
}

fs.rmSync(path.join(CJS.__dirname, PATHNAME.dist), { recursive: true, force: true });
await transpile({ format: 'cjs' });
await transpile({ format: 'esm' });
importEsm();
await generateTypes();

if (iswatch) {
  for (const [, entry] of entries.entries()) {
    const watcher = fs.watch(entry);
    watcher.on('change', async (_event, filename) => {
      const file = entries.find(e => e.includes(filename));
      await transpile({ format: 'cjs' }, file);
      await transpile({ format: 'esm' }, file);
      importEsm();
      await generateTypes();
    });
  }
  console.log(colours.yellow('[watch]'), 'waiting for file changes');
} else {
  console.log(colours.green('[build]'), 'success');
}
