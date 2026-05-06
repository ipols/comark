// Tests for the anchor module.
// Test-first per U4 execution note: each scenario captures expected
// behavior at threshold boundaries before the algorithm is finalized.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveAnchor,
  buildSelectors,
  THRESHOLD_ANCHORED,
  THRESHOLD_APPROXIMATE,
} from '../lib/anchor.js';
import { normalizeForAnchor } from '../lib/normalize.js';
import { sha256Hex } from '../lib/hash.js';

function docHashOf(text) {
  return `sha256:${sha256Hex(normalizeForAnchor(text))}`;
}

function makeComment({ doc, start, end, prefixLen = 32, suffixLen = 32 }) {
  const selectors = buildSelectors(doc, start, end, { prefixLen, suffixLen });
  return {
    id: 'test-id',
    target: {
      selectors,
      docHash: docHashOf(doc),
      docLength: normalizeForAnchor(doc).length,
    },
    thread: [],
  };
}

test('doc-hash fast path: unchanged doc → anchored at original position with score 1.0', async () => {
  const doc = 'The product team ships features faster than the docs can keep up.';
  const start = doc.indexOf('product team');
  const end = start + 'product team'.length;
  const comment = makeComment({ doc, start, end });

  const resolved = await resolveAnchor(doc, comment);

  assert.equal(resolved.anchorState, 'anchored');
  assert.equal(resolved.lastResolvedScore, 1.0);
  assert.deepEqual(resolved.resolvedRange, { start, end });
});

test('paragraph rewrite preserving the quote → still anchored at new position', async () => {
  const doc = 'The product team ships features faster than the docs can keep up.';
  const start = doc.indexOf('product team');
  const end = start + 'product team'.length;
  const comment = makeComment({ doc, start, end });

  // Rewrite: insert text BEFORE the quote so its absolute offset shifts.
  const rewritten =
    'In the past quarter, the product team ships features faster than the docs can keep up.';

  const resolved = await resolveAnchor(rewritten, comment);

  assert.equal(resolved.anchorState, 'anchored');
  assert.ok(resolved.lastResolvedScore >= THRESHOLD_ANCHORED);
  // Resolved range now points to the new offset.
  assert.equal(rewritten.slice(resolved.resolvedRange.start, resolved.resolvedRange.end), 'product team');
  assert.notEqual(resolved.resolvedRange.start, start);
});

test('synonym replacement → orphaned (score < 0.55), original quote preserved on the comment', async () => {
  const doc = 'We track weekly active users as the north-star metric.';
  const start = doc.indexOf('weekly active users');
  const end = start + 'weekly active users'.length;
  const comment = makeComment({ doc, start, end });

  // Heavy rewrite: phrase replaced with a different one and surrounding context changed.
  const rewritten = 'Our north-star metric is now weekly retention cohorts measured by churn surfaces.';

  const resolved = await resolveAnchor(rewritten, comment);

  assert.equal(resolved.anchorState, 'orphaned');
  assert.ok(resolved.lastResolvedScore < THRESHOLD_APPROXIMATE);
  // Original `exact` text MUST still be on the selectors so the orphans tray can render it.
  const quoteSel = resolved.target.selectors.find((s) => s.type === 'TextQuoteSelector');
  assert.equal(quoteSel.exact, 'weekly active users');
});

test('identical quotes appearing multiple times → prefix/suffix disambiguates to original location', async () => {
  const doc = [
    'Intro: see Section 3 for the architecture overview.',
    '',
    'Body: the discussion is dense; see Section 3 carefully before the meeting.',
    '',
    'Conclusion: see Section 3 once more for the wrap-up summary.',
  ].join('\n');

  const phrase = 'see Section 3';
  // Pick the second occurrence (in Body).
  const firstIdx = doc.indexOf(phrase);
  const bodyIdx = doc.indexOf(phrase, firstIdx + 1);
  const start = bodyIdx;
  const end = start + phrase.length;

  const comment = makeComment({ doc, start, end });

  // Re-resolve against the unchanged doc.
  const resolved = await resolveAnchor(doc, comment);

  assert.equal(resolved.anchorState, 'anchored');
  assert.deepEqual(resolved.resolvedRange, { start, end }, 'must pick the Body occurrence, not Intro/Conclusion');
});

test('identical quotes with shifted unrelated content → resolves to closest match by prefix/suffix', async () => {
  const original = [
    'Intro: see Section 3 for the architecture overview.',
    'Body: the discussion is dense; see Section 3 carefully before the meeting.',
    'Conclusion: see Section 3 once more for the wrap-up summary.',
  ].join('\n');

  const phrase = 'see Section 3';
  const firstIdx = original.indexOf(phrase);
  const bodyIdx = original.indexOf(phrase, firstIdx + 1);
  const comment = makeComment({ doc: original, start: bodyIdx, end: bodyIdx + phrase.length });

  // Insert a paragraph BEFORE Intro so positions shift, but prefix/suffix structure preserved around the Body anchor.
  const rewritten = 'Preface: housekeeping notes only.\n\n' + original;

  const resolved = await resolveAnchor(rewritten, comment);

  assert.equal(resolved.anchorState, 'anchored');
  assert.equal(
    rewritten.slice(resolved.resolvedRange.start, resolved.resolvedRange.end),
    phrase,
  );
  // Must be the BODY occurrence in rewritten doc (between Body: and Conclusion:), not Intro or Conclusion.
  const intro = rewritten.indexOf(phrase);
  const body = rewritten.indexOf(phrase, intro + 1);
  assert.equal(resolved.resolvedRange.start, body);
});

test('comment on first paragraph (empty prefix) anchors correctly', async () => {
  const doc = 'Opening sentence is right here.\n\nSecond paragraph follows.';
  const phrase = 'Opening sentence';
  const start = doc.indexOf(phrase);
  const end = start + phrase.length;
  const comment = makeComment({ doc, start, end });

  // Confirm prefix is empty.
  const quoteSel = comment.target.selectors.find((s) => s.type === 'TextQuoteSelector');
  assert.equal(quoteSel.prefix, '');

  const resolved = await resolveAnchor(doc, comment);
  assert.equal(resolved.anchorState, 'anchored');
  assert.deepEqual(resolved.resolvedRange, { start, end });
});

test('comment on last paragraph (empty suffix) anchors correctly', async () => {
  const doc = 'Opening sentence.\n\nSecond paragraph follows here as the closer';
  const phrase = 'as the closer';
  const start = doc.indexOf(phrase);
  const end = start + phrase.length;
  assert.equal(end, doc.length, 'phrase must extend to EOF for empty suffix');
  const comment = makeComment({ doc, start, end });

  const quoteSel = comment.target.selectors.find((s) => s.type === 'TextQuoteSelector');
  assert.equal(quoteSel.suffix, '');

  const resolved = await resolveAnchor(doc, comment);
  assert.equal(resolved.anchorState, 'anchored');
  assert.deepEqual(resolved.resolvedRange, { start, end });
});

test('completely rewritten doc with no shared content → orphaned', async () => {
  const original = 'This document explains widget calibration and torque limits.';
  const start = original.indexOf('widget calibration');
  const end = start + 'widget calibration'.length;
  const comment = makeComment({ doc: original, start, end });

  const rewritten = 'Pricing strategy update for the upcoming fiscal year quarter.';
  const resolved = await resolveAnchor(rewritten, comment);

  assert.equal(resolved.anchorState, 'orphaned');
});

test('approximate match: minor edit inside the quote keeps it anchored within tolerance', async () => {
  const doc = 'The reviewer should leave a comment when something feels off in the doc.';
  const start = doc.indexOf('reviewer should leave a comment');
  const end = start + 'reviewer should leave a comment'.length;
  const comment = makeComment({ doc, start, end });

  // Single word change inside the quote.
  const rewritten = 'The reviewer must leave a comment when something feels off in the doc.';

  const resolved = await resolveAnchor(rewritten, comment);

  assert.ok(
    resolved.anchorState === 'anchored' || resolved.anchorState === 'approximate',
    `expected anchored/approximate, got ${resolved.anchorState} (score ${resolved.lastResolvedScore})`,
  );
  assert.ok(resolved.lastResolvedScore >= THRESHOLD_APPROXIMATE);
});

test('two adjacent comments in the same doc both round-trip without offset interference', async () => {
  const doc = 'Sentence one is quick. Sentence two is also quick. Sentence three closes it out.';
  const c1 = makeComment({
    doc,
    start: doc.indexOf('one is quick'),
    end: doc.indexOf('one is quick') + 'one is quick'.length,
  });
  const c2 = makeComment({
    doc,
    start: doc.indexOf('two is also quick'),
    end: doc.indexOf('two is also quick') + 'two is also quick'.length,
  });

  const r1 = await resolveAnchor(doc, c1);
  const r2 = await resolveAnchor(doc, c2);

  assert.equal(r1.anchorState, 'anchored');
  assert.equal(r2.anchorState, 'anchored');
  // Ranges must not overlap.
  assert.ok(r1.resolvedRange.end <= r2.resolvedRange.start);
});

test('doc-hash fast path skipped when stored hash differs from current', async () => {
  // Stored hash deliberately wrong → must fall through to fuzzy match.
  const doc = 'Cover the architecture choices in the second section.';
  const start = doc.indexOf('architecture');
  const end = start + 'architecture'.length;
  const sel = buildSelectors(doc, start, end);
  const comment = {
    target: {
      selectors: sel,
      docHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    },
    thread: [],
  };

  const resolved = await resolveAnchor(doc, comment);
  assert.equal(resolved.anchorState, 'anchored');
  // Fuzzy match should still find it; score may not be exactly 1.0 because we skip the fast path.
  assert.ok(resolved.lastResolvedScore >= THRESHOLD_ANCHORED);
});
