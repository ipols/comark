// Static-asset serving for the SPA built into web/dist by Vite.
//
// On request:
//   - Resolve the request path under web/dist/.
//   - Refuse path traversal (anything with `..` or escaping the root).
//   - Serve the file with a sensible MIME type.
//   - Fall back to web/dist/index.html for any path without an extension
//     (SPA history routing).
//
// Until U5 ships the built SPA, we serve a minimal placeholder page that
// confirms the server is alive and explains the missing dist/.

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const DIST_ROOT = resolve(__dirname, '..', '..', 'web', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export function distExists() {
  return existsSync(join(DIST_ROOT, 'index.html'));
}

export function placeholderHtml(port) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>comark — server up</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    min-height: 100vh;
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
    display: grid;
    place-items: center;
    background: #fafaf7;
    color: #1f1d1a;
    padding: 24px;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #14130f; color: #ebe7df; }
    .card { background: #1c1a16; border-color: #2a2722; }
    code { background: #2a2722; }
  }
  .card {
    max-width: 560px;
    background: #fff;
    border: 1px solid #e6e2d8;
    border-radius: 12px;
    padding: 28px 32px;
    box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.04);
  }
  h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
  p { margin: 8px 0; color: inherit; opacity: .8; }
  code { background: #f0ece2; padding: 2px 6px; border-radius: 6px; font-size: 13px; }
  .muted { opacity: .6; font-size: 13px; }
</style>
</head>
<body>
  <main class="card">
    <h1>comark server is running on port ${port}.</h1>
    <p>The review surface (web/dist) hasn't been built yet — that's the U5 deliverable.</p>
    <p class="muted">Health probe: <code>GET /healthz</code></p>
    <p class="muted">Doc endpoint: <code>GET /api/docs/&lt;docId&gt;</code> (registered via the PostToolUse hook)</p>
  </main>
</body>
</html>`;
}

export async function serveStatic(req, res, urlPath, port) {
  // SPA fallback: any extensionless path returns the built index.html.
  const safePath = sanitizePath(urlPath);
  if (safePath === null) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden');
    return true;
  }

  if (!distExists()) {
    if (safePath === '/' || safePath === '/index.html' || extname(safePath) === '') {
      const body = placeholderHtml(port);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return true;
    }
    return false; // let the router 404 it
  }

  const candidate = safePath === '/' ? '/index.html' : safePath;
  const onDisk = resolve(DIST_ROOT, '.' + candidate);

  // Refuse anything resolving outside DIST_ROOT after symlink-free join.
  if (!onDisk.startsWith(DIST_ROOT + sep) && onDisk !== DIST_ROOT) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden');
    return true;
  }

  let stats;
  try {
    stats = await stat(onDisk);
  } catch {
    // SPA fallback for extensionless paths.
    if (extname(candidate) === '') {
      return serveFile(res, join(DIST_ROOT, 'index.html'));
    }
    return false;
  }

  if (stats.isDirectory()) {
    return serveFile(res, join(onDisk, 'index.html'));
  }
  return serveFile(res, onDisk);
}

function sanitizePath(p) {
  try {
    const decoded = decodeURIComponent(p);
    if (decoded.includes('\0')) return null;
    if (decoded.includes('..')) return null;
    return decoded;
  } catch {
    return null;
  }
}

async function serveFile(res, filePath) {
  try {
    const body = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      // Single-user local app: never cache. Avoids stale-asset surprises after
      // a `vite build`. The cost (one extra fetch per asset) is irrelevant on loopback.
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}
