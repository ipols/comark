// Lockfile manages a single-instance marker at ~/.comark/server.lock
// so the hook script can detect a running server and reuse it.

import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { request as httpRequest } from 'node:http';

const RUNTIME_DIR = join(homedir(), '.comark');
export const LOCKFILE_PATH = join(RUNTIME_DIR, 'server.lock');

export async function ensureRuntimeDir() {
  await mkdir(RUNTIME_DIR, { recursive: true });
}

export async function readLockfile() {
  if (!existsSync(LOCKFILE_PATH)) return null;
  try {
    const raw = await readFile(LOCKFILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.pid !== 'number' ||
      typeof parsed?.port !== 'number' ||
      typeof parsed?.startedAt !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeLockfile({ port, pid, startedAt }) {
  await ensureRuntimeDir();
  const payload = JSON.stringify({ port, pid, startedAt }, null, 2);
  await writeFile(LOCKFILE_PATH, payload, 'utf8');
}

export async function deleteLockfile() {
  if (!existsSync(LOCKFILE_PATH)) return;
  try {
    await unlink(LOCKFILE_PATH);
  } catch {
    // best effort
  }
}

// process-level liveness check via SIGNAL 0; throws if pid is dead.
export function isPidAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH → no such process; EPERM → exists but we can't signal (still alive)
    return err.code === 'EPERM';
  }
}

// HTTP-level liveness check; returns true iff /healthz answers OK quickly.
export function pingHealthz(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/healthz',
        method: 'GET',
        timeout: timeoutMs,
      },
      (res) => {
        // drain
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode === 200));
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

// Returns the running server's port if reachable, else null.
export async function findRunningServer() {
  const lock = await readLockfile();
  if (!lock) return null;
  if (!isPidAlive(lock.pid)) {
    await deleteLockfile();
    return null;
  }
  const alive = await pingHealthz(lock.port);
  if (!alive) {
    // PID alive but server not responsive → treat as stale
    return null;
  }
  return lock;
}
