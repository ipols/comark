// Bundle the comark HTTP server + MCP server into single files so the plugin
// ships without node_modules. Plugin install becomes truly two-command: the
// marketplace-add and plugin-install slash commands; no npm install at the
// user's end. (Same pattern Vite uses for the SPA bundle.)

import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

mkdirSync(resolve(root, 'server/dist'), { recursive: true });
mkdirSync(resolve(root, 'mcp/dist'), { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Node built-ins (node:*) are auto-external. Everything else is bundled.
  // We DON'T mark npm packages as external — that's the whole point.
  banner: {
    js: '// comark — bundled by esbuild. Do not edit by hand. Run `npm run bundle` to regenerate.\n',
  },
  define: {
    'process.env.COMARK_BUNDLED': '"true"',
  },
  metafile: false,
  legalComments: 'inline',
  minify: false,
};

const targets = [
  {
    label: 'HTTP server',
    entryPoints: [resolve(root, 'server/index.js')],
    outfile: resolve(root, 'server/dist/comark-server.js'),
  },
  {
    label: 'MCP server',
    entryPoints: [resolve(root, 'mcp/index.js')],
    outfile: resolve(root, 'mcp/dist/comark-mcp.js'),
  },
];

console.log(`comark — bundling for v${pkg.version}`);

for (const t of targets) {
  const before = Date.now();
  const result = await build({ ...common, entryPoints: t.entryPoints, outfile: t.outfile });
  const ms = Date.now() - before;
  const sizeKb = (
    readFileSync(t.outfile).length / 1024
  ).toFixed(1);
  console.log(`  ✓ ${t.label.padEnd(12)} → ${t.outfile.replace(root + '/', '')} (${sizeKb} KB, ${ms}ms)`);
  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.warn(`    ! ${w.text}`);
    }
  }
}

console.log('done.');
