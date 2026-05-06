// Tests for sidecar persistence: atomic write, schema-version handling,
// corruption recovery, round-trip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadComments,
  saveComments,
  resolveAllAnchors,
  sidecarPathFor,
} from '../lib/persistence.js';
import { buildSelectors } from '../lib/anchor.js';
import { sha256Hex } from '../lib/hash.js';
import { normalizeForAnchor } from '../lib/normalize.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'comark-test-'));
  const docPath = join(dir, 'sample.md');
  const docContent = 'Sample document for persistence testing.\n\nSecond paragraph here for variety.';
  writeFileSync(docPath, docContent, 'utf8');
  return { dir, docPath, docContent };
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

test('sidecarPathFor: produces <stem>.comark.json next to the source', () => {
  assert.equal(sidecarPathFor('/foo/bar.md'), '/foo/bar.comark.json');
  assert.equal(sidecarPathFor('/foo/bar.markdown'), '/foo/bar.comark.json');
  assert.equal(sidecarPathFor('/foo/bar.MD'), '/foo/bar.comark.json');
  // Non-markdown extension is preserved by stripping only the trailing extension.
  assert.equal(sidecarPathFor('/foo/bar.txt'), '/foo/bar.comark.json');
});

test('loadComments returns empty array when no sidecar exists', async () => {
  const { dir, docPath } = fixture();
  try {
    const comments = await loadComments(docPath);
    assert.deepEqual(comments, []);
  } finally {
    cleanup(dir);
  }
});

test('saveComments + loadComments round-trip preserves comment data', async () => {
  const { dir, docPath, docContent } = fixture();
  try {
    const start = docContent.indexOf('persistence testing');
    const end = start + 'persistence testing'.length;
    const selectors = buildSelectors(docContent, start, end);
    const comment = {
      id: 'abc-123',
      createdAt: '2026-05-06T00:00:00Z',
      updatedAt: '2026-05-06T00:00:00Z',
      state: 'open',
      anchorState: 'anchored',
      thread: [{ role: 'user', text: 'is this clear?' }],
      target: {
        selectors,
        docHash: `sha256:${sha256Hex(normalizeForAnchor(docContent))}`,
      },
    };

    await saveComments(docPath, [comment]);
    const loaded = await loadComments(docPath);

    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'abc-123');
    assert.equal(loaded[0].thread[0].text, 'is this clear?');
    assert.equal(loaded[0].target.selectors.length, 2);
  } finally {
    cleanup(dir);
  }
});

test('saveComments writes valid JSON with schemaVersion 1', async () => {
  const { dir, docPath } = fixture();
  try {
    await saveComments(docPath, []);
    const path = sidecarPathFor(docPath);
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.schemaVersion, 1);
    assert.deepEqual(parsed.comments, []);
  } finally {
    cleanup(dir);
  }
});

test('corrupted sidecar is archived and load returns empty (no crash)', async () => {
  const { dir, docPath } = fixture();
  try {
    const path = sidecarPathFor(docPath);
    writeFileSync(path, '{this is not: valid json', 'utf8');

    const loaded = await loadComments(docPath);
    assert.deepEqual(loaded, []);

    // The corrupted file should have been moved to <path>.bak.<timestamp>.
    const remaining = readdirSync(dir);
    const hasBackup = remaining.some((f) => f.startsWith('sample.comark.json.bak.'));
    assert.ok(hasBackup, `expected a .bak.* archive, got: ${remaining.join(', ')}`);
  } finally {
    cleanup(dir);
  }
});

test('unsupported schemaVersion: load returns empty (legacy/future migration boundary)', async () => {
  const { dir, docPath } = fixture();
  try {
    const path = sidecarPathFor(docPath);
    writeFileSync(path, JSON.stringify({ schemaVersion: 99, comments: [{ id: 'old' }] }), 'utf8');

    const loaded = await loadComments(docPath);
    assert.deepEqual(loaded, []);
  } finally {
    cleanup(dir);
  }
});

test('saveComments is atomic: tmp file is removed after rename', async () => {
  const { dir, docPath } = fixture();
  try {
    await saveComments(docPath, []);
    const tmpPath = sidecarPathFor(docPath) + '.tmp';
    assert.ok(!existsSync(tmpPath), 'tmp file must be cleaned up by rename');
  } finally {
    cleanup(dir);
  }
});

test('resolveAllAnchors annotates each stored comment with anchorState/score', async () => {
  const { dir, docPath, docContent } = fixture();
  try {
    const start = docContent.indexOf('persistence testing');
    const end = start + 'persistence testing'.length;
    const selectors = buildSelectors(docContent, start, end);
    const stored = [
      {
        id: 'abc-123',
        target: { selectors, docHash: `sha256:${sha256Hex(normalizeForAnchor(docContent))}` },
        thread: [],
      },
    ];

    const resolved = await resolveAllAnchors(docContent, stored);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].anchorState, 'anchored');
    assert.ok(typeof resolved[0].lastResolvedAt === 'string');
    assert.ok(typeof resolved[0].lastResolvedScore === 'number');
  } finally {
    cleanup(dir);
  }
});
