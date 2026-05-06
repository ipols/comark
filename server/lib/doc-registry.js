// In-memory registry of docs the hook has registered with the server.
// docId → { filePath, contextSummary, model, registeredAt }
//
// Doc *content* is read from disk on each /api/docs/:docId call so the
// review surface always reflects the latest state of the file (the agent
// may have rewritten it between hook firing and user opening the URL).

const docs = new Map();

export function registerDoc({ docId, filePath, contextSummary, model }) {
  if (!docId || !filePath) {
    throw new Error('registerDoc requires docId and filePath');
  }
  docs.set(docId, {
    docId,
    filePath,
    contextSummary: contextSummary ?? null,
    model: model ?? null,
    registeredAt: new Date().toISOString(),
  });
  return docs.get(docId);
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
