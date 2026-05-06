// Server-side event bus + sidecar watcher.
//
// Every browser tab that opens a doc subscribes via SSE to /api/events?docId=...
// On the server, we watch the underlying sidecar files (via fs.watchFile, which
// uses ~250ms polling — slow enough not to thrash, fast enough to feel
// instant). When a sidecar mutates — whether from this server's own comment
// save, the MCP server's post_answer, or any out-of-band edit — every subscribed
// browser gets an `update` event and refetches /api/docs/:id.

import { watchFile, unwatchFile, existsSync } from 'node:fs';
import { sidecarPathFor } from './persistence.js';

// docId → Set<ServerResponse>
const subscribers = new Map();
// docId → { sidecarPath } (so we can unwatch on last unsubscribe)
const watched = new Map();

function ensureWatch(docId, sidecarPath) {
  if (watched.has(docId)) return;
  watched.set(docId, { sidecarPath });
  watchFile(sidecarPath, { interval: 250, persistent: false }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    emit(docId, 'update', { reason: 'sidecar-changed', mtimeMs: curr.mtimeMs });
  });
}

function maybeStopWatch(docId) {
  const subs = subscribers.get(docId);
  if (subs && subs.size > 0) return;
  const w = watched.get(docId);
  if (!w) return;
  unwatchFile(w.sidecarPath);
  watched.delete(docId);
}

export function subscribe(docId, filePath, res) {
  // SSE headers + initial heartbeat.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': comark event stream open\n\n');

  let set = subscribers.get(docId);
  if (!set) {
    set = new Set();
    subscribers.set(docId, set);
  }
  set.add(res);

  // Start watching the sidecar lazily if not already.
  const sidecarPath = sidecarPathFor(filePath);
  if (existsSync(sidecarPath)) {
    ensureWatch(docId, sidecarPath);
  } else {
    // Sidecar doesn't exist yet — install a one-shot retry: when the first
    // comment lands, the file will appear; we watch immediately after that.
    // For V1 we just rely on the next subscribe call to set up the watch when
    // the file exists.
  }

  // Heartbeat every 25s to keep proxies awake. (Loopback-only doesn't need
  // this strictly, but it also covers the case where the browser is paused.)
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* ignore */ }
  }, 25_000);

  // Cleanup when the client disconnects.
  res.on('close', () => {
    clearInterval(heartbeat);
    const s = subscribers.get(docId);
    if (s) {
      s.delete(res);
      if (s.size === 0) subscribers.delete(docId);
    }
    maybeStopWatch(docId);
  });
}

export function emit(docId, event, data) {
  const set = subscribers.get(docId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      // Drop the stale subscriber; cleanup will land on next 'close'.
    }
  }
}

/** Direct emit when this process knows it just touched the sidecar (avoids
 *  waiting for the fs.watchFile poll interval). */
export function emitImmediate(docId, reason) {
  emit(docId, 'update', { reason, mtimeMs: Date.now() });
}

export function listSubscribed() {
  return [...subscribers.keys()];
}

export function shutdownAll() {
  for (const [docId, w] of watched.entries()) {
    unwatchFile(w.sidecarPath);
    watched.delete(docId);
  }
  for (const set of subscribers.values()) {
    for (const res of set) {
      try { res.end(); } catch { /* ignore */ }
    }
    set.clear();
  }
  subscribers.clear();
}
