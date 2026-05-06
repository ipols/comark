// Anchor module — fuzzy-match comment selectors against the current doc.
//
// Algorithm ported from
//   hypothesis/client/src/annotator/anchoring/match-quote.ts
//   (BSD-2-Clause; see LICENSE for full attribution).
//
// Strategy:
//   1. Normalize the doc (NFC + LF). Stored docHash is sha256(normalized).
//   2. Doc-hash fast path: identical hash → trust the stored
//      TextPositionSelector and return score 1.0.
//   3. Otherwise: run approx-string-match on the quote against the
//      normalized doc with maxErrors = floor(quote.length / 2). For each
//      candidate match, compute a weighted composite score from the
//      quote-edit-distance, prefix-similarity, suffix-similarity, and
//      position-distance. Return the highest-scoring match.
//   4. Map the score to one of three states:
//        ≥ 0.85 → anchored
//        0.55–0.85 → approximate (rendered with a `~` badge)
//        < 0.55 → orphaned (surfaced in the orphans tray)

import search from 'approx-string-match';

import { normalizeForAnchor } from './normalize.js';
import { sha256Hex } from './hash.js';

export const THRESHOLD_ANCHORED = 0.85;
export const THRESHOLD_APPROXIMATE = 0.55;

// Hypothesis production weights.
const W_QUOTE = 50;
const W_PREFIX = 20;
const W_SUFFIX = 20;
const W_POSITION = 2;
const W_TOTAL = W_QUOTE + W_PREFIX + W_SUFFIX + W_POSITION;

const DEFAULT_PREFIX_LEN = 32;
const DEFAULT_SUFFIX_LEN = 32;

// Build the W3C-style selector triple for a {start,end} range in normalized
// doc content. Used by the SPA at comment-creation time and by tests to seed
// realistic comment fixtures.
export function buildSelectors(content, start, end, options = {}) {
  const prefixLen = options.prefixLen ?? DEFAULT_PREFIX_LEN;
  const suffixLen = options.suffixLen ?? DEFAULT_SUFFIX_LEN;
  const normalized = normalizeForAnchor(content);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end > normalized.length ||
    end < start
  ) {
    throw new Error(`buildSelectors: invalid range start=${start} end=${end} length=${normalized.length}`);
  }

  const exact = normalized.slice(start, end);
  const prefix = normalized.slice(Math.max(0, start - prefixLen), start);
  const suffix = normalized.slice(end, Math.min(normalized.length, end + suffixLen));

  return [
    { type: 'TextQuoteSelector', exact, prefix, suffix },
    { type: 'TextPositionSelector', start, end },
  ];
}

export async function resolveAnchor(docContent, comment) {
  const target = comment?.target || {};
  const selectors = Array.isArray(target.selectors) ? target.selectors : [];

  const normalized = normalizeForAnchor(docContent);
  const currentHash = `sha256:${sha256Hex(normalized)}`;

  // Fast path: doc unchanged → trust position selector.
  if (target.docHash && target.docHash === currentHash) {
    const pos = selectors.find((s) => s?.type === 'TextPositionSelector');
    if (pos && Number.isFinite(pos.start) && Number.isFinite(pos.end)) {
      return resolved(comment, {
        anchorState: 'anchored',
        score: 1.0,
        range: { start: pos.start, end: pos.end },
      });
    }
  }

  const quote = selectors.find((s) => s?.type === 'TextQuoteSelector');
  if (!quote || typeof quote.exact !== 'string' || quote.exact.length === 0) {
    return orphan(comment);
  }

  const expectedPos = selectors.find((s) => s?.type === 'TextPositionSelector');
  const expectedStart = Number.isFinite(expectedPos?.start) ? expectedPos.start : 0;

  const best = matchQuote({
    doc: normalized,
    exact: quote.exact,
    prefix: typeof quote.prefix === 'string' ? quote.prefix : '',
    suffix: typeof quote.suffix === 'string' ? quote.suffix : '',
    expectedStart,
  });

  if (!best) {
    return orphan(comment);
  }

  if (best.score < THRESHOLD_APPROXIMATE) {
    return orphan(comment);
  }

  return resolved(comment, {
    anchorState: best.score >= THRESHOLD_ANCHORED ? 'anchored' : 'approximate',
    score: best.score,
    range: { start: best.start, end: best.end },
  });
}

function resolved(comment, { anchorState, score, range }) {
  return {
    ...comment,
    anchorState,
    lastResolvedAt: new Date().toISOString(),
    lastResolvedScore: round3(score),
    resolvedRange: range,
  };
}

function orphan(comment) {
  return {
    ...comment,
    anchorState: 'orphaned',
    lastResolvedAt: new Date().toISOString(),
    lastResolvedScore: 0,
  };
}

// Core fuzzy-match: returns the best candidate with a composite score.
function matchQuote({ doc, exact, prefix, suffix, expectedStart }) {
  if (exact.length === 0 || doc.length === 0) return null;

  // Quote-edit-distance budget. Hypothesis caps at 256; match production.
  const maxErrors = Math.min(256, Math.max(1, Math.floor(exact.length / 2)));
  let candidates;
  try {
    candidates = search(doc, exact, maxErrors);
  } catch {
    return null;
  }
  if (!candidates || candidates.length === 0) return null;

  let best = null;
  for (const candidate of candidates) {
    // Quote score: 1 when 0 errors, decays linearly with errors.
    const quoteScore = clamp01(1 - candidate.errors / Math.max(1, exact.length));

    // Prefix score: similarity between stored prefix and the doc text
    // immediately before the candidate match.
    let prefixScore = 1;
    if (prefix && prefix.length > 0) {
      const observed = doc.slice(Math.max(0, candidate.start - prefix.length), candidate.start);
      prefixScore = stringSimilarity(observed, prefix);
    }

    // Suffix score: same, looking forward.
    let suffixScore = 1;
    if (suffix && suffix.length > 0) {
      const observed = doc.slice(
        candidate.end,
        Math.min(doc.length, candidate.end + suffix.length),
      );
      suffixScore = stringSimilarity(observed, suffix);
    }

    // Position score: closer to expected start = higher.
    const positionScore = clamp01(
      doc.length === 0 ? 1 : 1 - Math.abs(candidate.start - expectedStart) / doc.length,
    );

    const score =
      (W_QUOTE * quoteScore +
        W_PREFIX * prefixScore +
        W_SUFFIX * suffixScore +
        W_POSITION * positionScore) /
      W_TOTAL;

    if (best === null || score > best.score) {
      best = { ...candidate, score };
    }
  }

  return best;
}

// String similarity in [0, 1] = 1 - normalized Levenshtein distance.
// We use the same approx-string-match engine: search(longer, shorter, maxErrors)
// returns the minimum errors needed; that's our edit distance.
function stringSimilarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const distance = levenshtein(a, b);
  return clamp01(1 - distance / Math.max(a.length, b.length));
}

// Tiny iterative Levenshtein. O(min(a,b)) memory, O(a*b) time.
// Bounded by the prefix/suffix length cap (32 chars) so this stays fast.
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[n];
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}
