// Anchor resolution — port of Hypothesis client/src/annotator/anchoring/match-quote.ts
// (BSD-2-Clause). U4 fills in the real algorithm using approx-string-match.
//
// For U3 boot-up: pass-through that trusts stored TextPositionSelector when the
// doc hash matches; marks orphaned otherwise. This stub is replaced by U4.

import { normalizeForAnchor } from './normalize.js';
import { sha256Hex } from './hash.js';

const THRESHOLD_ANCHORED = 0.85;
const THRESHOLD_APPROXIMATE = 0.55;

export async function resolveAnchor(docContent, comment) {
  const out = { ...comment };
  const target = comment.target || {};
  const selectors = Array.isArray(target.selectors) ? target.selectors : [];

  const normalized = normalizeForAnchor(docContent);
  const currentHash = `sha256:${sha256Hex(normalized)}`;

  // Doc-hash fast path: identical doc → trust the stored position selector.
  if (target.docHash && target.docHash === currentHash) {
    const pos = selectors.find((s) => s?.type === 'TextPositionSelector');
    if (pos && Number.isFinite(pos.start) && Number.isFinite(pos.end)) {
      out.anchorState = 'anchored';
      out.lastResolvedAt = new Date().toISOString();
      out.lastResolvedScore = 1.0;
      out.resolvedRange = { start: pos.start, end: pos.end };
      return out;
    }
  }

  // U4 stub: without approximate-match, fall back to exact substring search of the quote.
  const quote = selectors.find((s) => s?.type === 'TextQuoteSelector');
  if (quote?.exact) {
    const idx = normalized.indexOf(quote.exact);
    if (idx >= 0) {
      out.anchorState = 'anchored';
      out.lastResolvedAt = new Date().toISOString();
      out.lastResolvedScore = 1.0;
      out.resolvedRange = { start: idx, end: idx + quote.exact.length };
      return out;
    }
  }

  out.anchorState = 'orphaned';
  out.lastResolvedAt = new Date().toISOString();
  out.lastResolvedScore = 0;
  return out;
}

export { THRESHOLD_ANCHORED, THRESHOLD_APPROXIMATE };
