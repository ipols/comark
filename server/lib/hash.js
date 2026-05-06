// Hash helpers — SHA-256 of normalized doc, and 16-char docId derivation.

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';

export function sha256Hex(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// docId = sha256(canonicalized-absolute-path).slice(0, 16)
// Canonicalization: realpath (follow symlinks) + NFC + lowercased extension
// to avoid two-cwd-relative-path collisions.
export function deriveDocId(filePath) {
  let canonical;
  try {
    canonical = realpathSync(filePath);
  } catch {
    canonical = filePath;
  }
  const normalized = canonical.normalize('NFC');
  // Lowercase the extension only — not the full path (case-sensitive on Linux).
  const dotIdx = normalized.lastIndexOf('.');
  const slashIdx = normalized.lastIndexOf('/');
  const finalPath =
    dotIdx > slashIdx
      ? normalized.slice(0, dotIdx) + normalized.slice(dotIdx).toLowerCase()
      : normalized;
  return sha256Hex(finalPath).slice(0, 16);
}
