import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const outfile = path.join(root, 'server', 'server.bundle.mjs');

await mkdir(path.dirname(outfile), { recursive: true });

await build({
  entryPoints: [path.join(root, 'server', 'src', 'index.js')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire as __rrCreateRequire } from 'node:module'; const require = __rrCreateRequire(import.meta.url);",
  },
});

console.log(`server bundle written to ${outfile}`);
