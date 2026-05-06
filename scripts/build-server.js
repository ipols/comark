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

// Output bundles into the ./plugin/ subdirectory so they're packaged as
// part of the plugin install (per the marketplace's source: './plugin'
// declaration). The bin/, mcp/, server/ + web/src at the repo root remain source-only.
mkdirSync(resolve(root, 'plugin/server/dist'), { recursive: true });
mkdirSync(resolve(root, 'plugin/mcp/dist'), { recursive: true });
mkdirSync(resolve(root, 'plugin/bin'), { recursive: true });

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
    outfile: resolve(root, 'plugin/server/dist/comark-server.js'),
  },
  {
    label: 'MCP server',
    entryPoints: [resolve(root, 'mcp/index.js')],
    outfile: resolve(root, 'plugin/mcp/dist/comark-mcp.js'),
  },
  {
    label: 'Hook script',
    entryPoints: [resolve(root, 'bin/comark-hook.js')],
    outfile: resolve(root, 'plugin/bin/comark-hook.js'),
    // Hook needs to be executable + run with `#!/usr/bin/env node` shebang.
    bannerOverride: '#!/usr/bin/env node\n// comark hook — bundled by esbuild. Do not edit by hand.\n',
  },
];

console.log(`comark — bundling for v${pkg.version}`);

for (const t of targets) {
  const before = Date.now();
  const cfg = { ...common, entryPoints: t.entryPoints, outfile: t.outfile };
  if (t.bannerOverride) cfg.banner = { js: t.bannerOverride };
  const result = await build(cfg);
  const ms = Date.now() - before;
  const sizeKb = (
    readFileSync(t.outfile).length / 1024
  ).toFixed(1);
  console.log(`  ✓ ${t.label.padEnd(13)} → ${t.outfile.replace(root + '/', '')} (${sizeKb} KB, ${ms}ms)`);
  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.warn(`    ! ${w.text}`);
    }
  }
  // Make the hook script executable (the only target that needs to be invoked directly).
  if (t.label === 'Hook script') {
    const { chmodSync } = await import('node:fs');
    chmodSync(t.outfile, 0o755);
  }
}

console.log('done.');
