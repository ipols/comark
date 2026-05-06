#!/usr/bin/env node
// comark PostToolUse hook — fires on Write|Edit tool calls.
//
// Reads JSON from stdin (Claude Code's hook event payload), decides whether
// this write is reviewable, spawns or reuses the local server, registers
// the doc, and emits an additionalContext envelope so the URL surfaces in
// the user's chat.
//
// Critical constraints:
//   - Total runtime must stay under the configured timeout (~10s).
//   - On any unexpected error, exit 0 with no envelope so the user's session
//     is never disrupted by a hook crash. We log to stderr (visible in the
//     transcript when `claude --debug`).

import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildContextSummary } from './comark-context.js';
import {
  findRunningServer,
  pingHealthz,
  readLockfile,
} from '../server/lib/lockfile.js';
import { deriveDocId } from '../server/lib/hash.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, '..');
const SERVER_ENTRYPOINT = resolve(PLUGIN_ROOT, 'server', 'index.js');

const DEFAULT_THRESHOLD = 200;
const COLD_START_POLL_MS = 3000;
const COLD_START_INTERVAL_MS = 100;

async function readStdin() {
  return new Promise((resolveStdin) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolveStdin(data));
    process.stdin.on('error', () => resolveStdin(data));
  });
}

function logDebug(msg) {
  process.stderr.write(`comark hook: ${msg}\n`);
}

function thresholdFromEnv() {
  const raw = process.env.COMARK_MIN_LENGTH;
  if (!raw) return DEFAULT_THRESHOLD;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_THRESHOLD;
  return parsed;
}

function isMarkdownPath(p) {
  if (typeof p !== 'string') return false;
  return /\.mdx?$/i.test(p) || /\.markdown$/i.test(p);
}

async function fileSizeBytes(filePath) {
  try {
    const s = await stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
}

async function spawnServerDetached() {
  const child = spawn(process.execPath, [SERVER_ENTRYPOINT], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
    cwd: PLUGIN_ROOT,
  });
  child.unref();
}

async function ensureServerRunning() {
  const existing = await findRunningServer();
  if (existing) {
    return { port: existing.port, coldStarted: false };
  }

  await spawnServerDetached();

  // Poll for liveness up to COLD_START_POLL_MS.
  const start = Date.now();
  while (Date.now() - start < COLD_START_POLL_MS) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(COLD_START_INTERVAL_MS);
    // eslint-disable-next-line no-await-in-loop
    const lock = await readLockfile();
    if (lock?.port) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await pingHealthz(lock.port, 500);
      if (ok) return { port: lock.port, coldStarted: true };
    }
  }

  // Best-effort: return whatever we have, even if not yet responding.
  const lock = await readLockfile();
  if (lock?.port) return { port: lock.port, coldStarted: true, slowBoot: true };
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postRegisterDoc(port, payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolveReq) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/api/register-doc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Origin: `http://localhost:${port}`,
        },
        timeout: 2500,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolveReq(res.statusCode === 200));
      },
    );
    req.on('error', () => resolveReq(false));
    req.on('timeout', () => {
      req.destroy();
      resolveReq(false);
    });
    req.write(body);
    req.end();
  });
}

function buildEnvelope({ message }) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: message,
    },
  });
}

async function main() {
  // Always exit 0 unless we explicitly want to signal an error to Claude.
  // The hook should never crash the user's session.

  let event;
  try {
    const raw = await readStdin();
    if (!raw.trim()) {
      logDebug('no stdin payload; exiting silently');
      process.exit(0);
    }
    event = JSON.parse(raw);
  } catch (err) {
    logDebug(`stdin parse error: ${err.message}`);
    process.exit(0);
  }

  const toolName = event?.tool_name;
  const toolInput = event?.tool_input || {};
  const filePath = toolInput.file_path;
  const transcriptPath = event?.transcript_path;

  if (toolName !== 'Write' && toolName !== 'Edit') {
    process.exit(0); // matcher should already restrict, but defensive
  }

  if (!isMarkdownPath(filePath)) {
    process.exit(0);
  }

  // Threshold check: prefer disk size (post-write); fall back to in-payload
  // content length when the file isn't yet on disk for some reason.
  const threshold = thresholdFromEnv();
  let size = await fileSizeBytes(filePath);
  if (size === 0 && typeof toolInput.content === 'string') {
    size = Buffer.byteLength(toolInput.content, 'utf8');
  }
  if (size < threshold) {
    logDebug(`below threshold (${size} < ${threshold}); skipping`);
    process.exit(0);
  }

  // Build context summary + model from transcript.
  let summary = null;
  let model = null;
  if (transcriptPath) {
    try {
      const result = await buildContextSummary(transcriptPath);
      summary = result.summary;
      model = result.model;
    } catch (err) {
      logDebug(`context summary error: ${err.message}`);
    }
  }
  if (!model) {
    model = process.env.COMARK_MODEL || null;
    if (model) logDebug(`using COMARK_MODEL fallback: ${model}`);
  }

  // Read current doc content for registration.
  let docContent = '';
  try {
    docContent = await readFile(filePath, 'utf8');
  } catch (err) {
    logDebug(`cannot read ${filePath}: ${err.message}`);
    process.exit(0);
  }

  // Spawn or reuse server.
  let server;
  try {
    server = await ensureServerRunning();
  } catch (err) {
    logDebug(`server bootstrap error: ${err.message}`);
    process.exit(0);
  }
  if (!server) {
    process.stdout.write(
      buildEnvelope({
        message:
          'comark could not start its review server. Set `COMARK_PORT` if 8888-8898 are taken, then re-edit the file.',
      }),
    );
    process.exit(0);
  }

  const docId = deriveDocId(filePath);
  const ok = await postRegisterDoc(server.port, {
    docId,
    filePath,
    contextSummary: summary,
    model,
  });

  if (!ok && !server.slowBoot) {
    logDebug('register-doc returned non-OK');
  }

  const url = `http://localhost:${server.port}/?doc=${docId}`;
  const lines = [];
  if (server.slowBoot) {
    lines.push(
      `comark is starting up. Open ${url} — the page may take a moment to load on first start.`,
    );
  } else if (server.coldStarted) {
    lines.push(`comark review surface ready at ${url}`);
  } else {
    lines.push(`comark review surface for this doc: ${url}`);
  }
  if (model) {
    lines.push(`Model used for inline answers: \`${model}\`.`);
  }
  lines.push(
    'Open the URL in your browser. To pin it inside Claude Code, ask the assistant to "open the preview pane on this URL".',
  );

  process.stdout.write(buildEnvelope({ message: lines.join('\n') }));
  process.exit(0);
}

main().catch((err) => {
  logDebug(`fatal: ${err?.stack || err?.message || err}`);
  // Still exit 0 so we never disrupt the user's session.
  process.exit(0);
});
