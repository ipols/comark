// SSE event stream for sidecar updates. Browser tabs subscribe to receive
// "update" events whenever a doc's comments change (from this server's own
// comment save, from the MCP server posting an answer, or from any external
// sidecar edit).

import { sendJson } from '../lib/router.js';
import { getDoc } from '../lib/doc-registry.js';
import { subscribe } from '../lib/event-bus.js';

export async function handleEventStream(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const docId = url.searchParams.get('docId');
  if (!docId) {
    return sendJson(res, 400, { error: 'docId query param required' });
  }
  const entry = getDoc(docId);
  if (!entry) {
    return sendJson(res, 404, { error: 'Doc not registered' });
  }
  subscribe(docId, entry.filePath, res);
}
