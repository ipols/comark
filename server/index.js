#!/usr/bin/env node
// comark local server — entrypoint.
//
// Boot sequence:
//   1. Check ~/.comark/server.lock for a live instance; if so, exit 0.
//   2. Pick a port (COMARK_PORT or 8888-8898 fallback).
//   3. Start HTTP server, write lockfile, install graceful-shutdown handlers.
//   4. Route requests through the tiny router (lib/router.js).
//
// Endpoints:
//   GET  /healthz                  — liveness probe (no Origin check)
//   POST /api/register-doc         — Origin-validated; called by the hook
//   GET  /api/docs/:docId          — load doc + comments (re-resolved)
//   GET  /api/comments/:docId      — incremental comment fetch
//   POST /api/comments/:docId      — Origin-validated; create/update comment
//   POST /api/llm/answer           — Origin-validated; SSE streaming answer
//   GET  /, /assets/*, ...         — static SPA assets from web/dist/

import { createServer } from 'node:http';
import { pickAvailablePort } from './lib/port-manager.js';
import {
  ensureRuntimeDir,
  findRunningServer,
  writeLockfile,
  deleteLockfile,
} from './lib/lockfile.js';
import {
  createRouter,
  isOriginAllowed,
  sendJson,
  sendText,
  STATE_MUTATING_METHODS,
} from './lib/router.js';
import { handleRegisterDoc, handleGetDoc } from './api/docs.js';
import { handleListComments, handleSaveComment } from './api/comments.js';
import { handleLlmAnswer } from './api/llm.js';
import { serveStatic, distExists } from './lib/static.js';

export const VERSION = '0.1.0';

async function bootstrap() {
  // Reuse existing instance if alive.
  const existing = await findRunningServer();
  if (existing) {
    process.stderr.write(
      `comark: server already running on port ${existing.port} (pid ${existing.pid}); reusing.\n`,
    );
    process.exit(0);
  }

  await ensureRuntimeDir();

  const port = await pickAvailablePort();

  const router = createRouter();

  // Health probe (no Origin check).
  router.get('/healthz', (req, res) => {
    sendJson(res, 200, { ok: true, version: VERSION, port });
  }, { skipOriginCheck: true });

  // Doc registration / retrieval.
  router.post('/api/register-doc', (req, res) => handleRegisterDoc(req, res));
  router.get('/api/docs/:docId', (req, res, params) => handleGetDoc(req, res, params));

  // Comments.
  router.get('/api/comments/:docId', (req, res, params) => handleListComments(req, res, params));
  router.post('/api/comments/:docId', (req, res, params) => handleSaveComment(req, res, params));

  // LLM SSE.
  router.post('/api/llm/answer', (req, res) => handleLlmAnswer(req, res));

  const server = createServer(async (req, res) => {
    try {
      await dispatch(router, req, res, port);
    } catch (err) {
      process.stderr.write(`comark request error: ${err?.message || err}\n`);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal server error' });
      } else {
        try { res.end(); } catch { /* noop */ }
      }
    }
  });

  // Listen on loopback only — never expose to the network.
  server.listen(port, '127.0.0.1', async () => {
    await writeLockfile({ port, pid: process.pid, startedAt: new Date().toISOString() });
    const distNote = distExists() ? '' : ' (placeholder UI; web/dist not built)';
    process.stderr.write(`comark: listening on http://127.0.0.1:${port}${distNote}\n`);
  });

  // Graceful shutdown — clean up the lockfile so the next start doesn't
  // think we're still alive.
  const shutdown = async (signal) => {
    process.stderr.write(`comark: ${signal} received; shutting down.\n`);
    server.close(() => {});
    await deleteLockfile();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', async (err) => {
    process.stderr.write(`comark: uncaught exception: ${err?.stack || err}\n`);
    await deleteLockfile();
    process.exit(1);
  });
}

async function dispatch(router, req, res, port) {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const path = url.pathname;
  const method = (req.method || 'GET').toUpperCase();

  // Match API/route table first.
  const matched = router.matchRoute(method, path);
  if (matched) {
    if (
      STATE_MUTATING_METHODS.has(method) &&
      !matched.route.skipOriginCheck &&
      !isOriginAllowed(req, port)
    ) {
      return sendJson(res, 403, {
        error: 'Origin not allowed. comark only accepts requests from http://localhost:<server-port>.',
      });
    }
    return matched.route.handler(req, res, matched.params);
  }

  // Fall through to static assets.
  if (method === 'GET' || method === 'HEAD') {
    const served = await serveStatic(req, res, path, port);
    if (served) return;
  }

  return sendJson(res, 404, { error: `No route for ${method} ${path}` });
}

// Auto-boot only when invoked directly (not when imported by tests).
const isDirectInvocation =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isDirectInvocation) {
  bootstrap().catch(async (err) => {
    process.stderr.write(`comark: fatal startup error: ${err?.message || err}\n`);
    await deleteLockfile().catch(() => {});
    process.exit(1);
  });
}

export { bootstrap };
