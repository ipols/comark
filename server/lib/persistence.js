// Sidecar persistence: stores comments next to the source markdown as
// `<doc-stem>.comark.json`. Atomic writes via tmp-file rename.
//
// U4 wires up the full anchor algorithm in resolveAllAnchors. For U3
// boot-up purposes, the stub here passes comments through unchanged.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, basename, extname, join } from 'node:path';
import { resolveAnchor } from './anchor.js';

const SCHEMA_VERSION = 1;

export function sidecarPathFor(docFilePath) {
  const dir = dirname(docFilePath);
  const base = basename(docFilePath);
  const stem = base.endsWith('.md') ? base.slice(0, -3) : base.replace(extname(base), '');
  return join(dir, `${stem}.comark.json`);
}

export async function loadComments(docFilePath) {
  const path = sidecarPathFor(docFilePath);
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== SCHEMA_VERSION) {
      // Future: migration. For now, refuse silently and let user fix manually.
      return [];
    }
    return Array.isArray(parsed.comments) ? parsed.comments : [];
  } catch (err) {
    // Corrupted sidecar: archive and return empty so the user can keep working.
    try {
      const backup = `${path}.bak.${Date.now()}`;
      await rename(path, backup);
    } catch {
      // best effort
    }
    return [];
  }
}

export async function saveComments(docFilePath, comments) {
  const path = sidecarPathFor(docFilePath);
  const tmp = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  const payload = JSON.stringify(
    { schemaVersion: SCHEMA_VERSION, comments },
    null,
    2,
  );
  await writeFile(tmp, payload, 'utf8');
  await rename(tmp, path);
}

// Re-resolve every comment's anchor against current doc content.
// Each comment receives `anchorState`, `lastResolvedScore`, `lastResolvedAt`,
// and (when resolved) `resolvedRange` { start, end }.
export async function resolveAllAnchors(docContent, comments) {
  const out = [];
  for (const comment of comments) {
    const resolved = await resolveAnchor(docContent, comment);
    out.push(resolved);
  }
  return out;
}
