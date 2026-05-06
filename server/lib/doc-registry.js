// In-memory registry of docs the hook has registered with the server,
// mirrored to ~/.comark/docs.json so the MCP server (separate process)
// can find sidecars to scan.
//
// docId → { filePath, transcriptPath, contextSummary, model, registeredAt }
//
// Doc *content* is read from disk on each /api/docs/:docId call so the
// review surface always reflects the latest state of the file (the agent
// may have rewritten it between hook firing and user opening the URL).

import { upsertDocInRegistry } from './shared-registry.js';

const docs = new Map();

export async function registerDoc({ docId, filePath, transcriptPath, contextSummary, model }) {
  if (!docId || !filePath) {
    throw new Error('registerDoc requires docId and filePath');
  }
  const entry = {
    docId,
    filePath,
    transcriptPath: transcriptPath ?? null,
    contextSummary: contextSummary ?? null,
    model: model ?? null,
    registeredAt: new Date().toISOString(),
  };
  docs.set(docId, entry);
  // Mirror to ~/.comark/docs.json for the MCP server. Best-effort — we don't
  // want a registry write failure to break doc registration.
  try {
    await upsertDocInRegistry(entry);
  } catch (err) {
    process.stderr.write(`comark: shared registry write failed: ${err?.message || err}\n`);
  }
  return entry;
}

export function getDoc(docId) {
  return docs.get(docId) ?? null;
}

export function listDocs() {
  return [...docs.values()];
}

export function clearAllDocs() {
  docs.clear();
}
