// Port selection: prefer COMARK_PORT (default 8888), fall back through 8888-8898.
// We listen on the candidate; if EADDRINUSE, advance to the next.

import { createServer } from 'node:net';

const FALLBACK_RANGE_START = 8888;
const FALLBACK_RANGE_END = 8898;

export function preferredPort() {
  const fromEnv = process.env.COMARK_PORT;
  if (!fromEnv) return FALLBACK_RANGE_START;
  const parsed = Number.parseInt(fromEnv, 10);
  if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) return parsed;
  return FALLBACK_RANGE_START;
}

export function fallbackCandidates(preferred) {
  const candidates = [preferred];
  for (let p = FALLBACK_RANGE_START; p <= FALLBACK_RANGE_END; p += 1) {
    if (p !== preferred) candidates.push(p);
  }
  return candidates;
}

export function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') resolve(false);
      else resolve(false); // any error → treat as not free
    });
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '127.0.0.1');
  });
}

export async function pickAvailablePort() {
  const preferred = preferredPort();
  for (const port of fallbackCandidates(preferred)) {
    // eslint-disable-next-line no-await-in-loop
    const free = await isPortFree(port);
    if (free) return port;
  }
  throw new Error(
    `No port available in range ${FALLBACK_RANGE_START}-${FALLBACK_RANGE_END}. Set COMARK_PORT to a free port or stop the conflicting process.`,
  );
}
