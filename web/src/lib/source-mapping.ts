/*
 * Source-mapping helpers — bridge between rendered DOM (what the user sees +
 * selects) and the markdown source string (what the server's anchor algorithm
 * matches against).
 *
 * The rehype-source-position plugin (server-side equivalent in U5) emits
 * `data-sourcepos="<start>:<end>"` on every element. We use that as a coarse
 * map: the nearest ancestor element with data-sourcepos tells us where the
 * containing block lives in source.
 *
 * For sub-block precision we don't try to reproduce a perfect rendered↔source
 * offset projection — markdown's formatting syntax (`**bold**` ≠ rendered
 * "bold") makes that lossy without re-running the parser. Instead, the
 * approach is:
 *   - Send the rendered selected text as `exact`. The server's fuzzy match
 *     (Hypothesis match-quote port) tolerates the syntax-vs-rendered mismatch.
 *   - Compute prefix/suffix from rendered text (32 chars each side).
 *   - Provide an approximate source-position from the nearest element's
 *     data-sourcepos so the position-distance score has a useful signal.
 */

const PREFIX_SUFFIX_LEN = 32;

/** Find the closest ancestor (or self) with a `data-sourcepos` attribute. */
export function findSourceposAncestor(node: Node | null): HTMLElement | null {
  let cur: Node | null = node;
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.hasAttribute('data-sourcepos')) return el;
    }
    cur = cur.parentNode;
  }
  return null;
}

/** Parse `data-sourcepos="<start>:<end>"`. */
export function parseSourcepos(el: HTMLElement | null): { start: number; end: number } | null {
  if (!el) return null;
  const raw = el.getAttribute('data-sourcepos');
  if (!raw) return null;
  const m = raw.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]) };
}

/**
 * Capture rendered prefix/suffix (up to PREFIX_SUFFIX_LEN chars) around a
 * Range, walking outward through text nodes. Skips invisible content
 * (display:none, etc.) implicitly because TreeWalker stays in flow.
 */
export function capturePrefixSuffix(root: HTMLElement, range: Range) {
  const allText = renderedTextWithMap(root);
  const startIdx = mapNodeOffsetToFlatIndex(allText, range.startContainer, range.startOffset);
  const endIdx = mapNodeOffsetToFlatIndex(allText, range.endContainer, range.endOffset);

  const prefix = startIdx > 0 ? allText.text.slice(Math.max(0, startIdx - PREFIX_SUFFIX_LEN), startIdx) : '';
  const suffix = endIdx < allText.text.length
    ? allText.text.slice(endIdx, Math.min(allText.text.length, endIdx + PREFIX_SUFFIX_LEN))
    : '';
  return { prefix, suffix, exact: allText.text.slice(startIdx, endIdx) };
}

type FlatTextMap = {
  text: string;
  // For each text node: (node, baseIndex). baseIndex = where this node's
  // contents start in `text`.
  nodes: Array<{ node: Text; base: number }>;
};

/** Walk all text nodes under root, concatenating into a flat string. */
export function renderedTextWithMap(root: HTMLElement): FlatTextMap {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const nodes: FlatTextMap['nodes'] = [];
  let text = '';
  let cur: Node | null;
  // eslint-disable-next-line no-cond-assign
  while ((cur = walker.nextNode())) {
    const n = cur as Text;
    nodes.push({ node: n, base: text.length });
    text += n.data;
  }
  return { text, nodes };
}

function mapNodeOffsetToFlatIndex(
  flat: FlatTextMap,
  node: Node,
  offset: number,
): number {
  // If the offset lands on an element, drill into the appropriate child.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    const child = el.childNodes[offset];
    if (!child) {
      // After the last child — push to end of element's text content.
      return mapNodeOffsetToFlatIndex(flat, el, el.childNodes.length - 1) + (el.lastChild?.textContent?.length || 0);
    }
    return mapNodeOffsetToFlatIndex(flat, child, 0);
  }
  if (node.nodeType !== Node.TEXT_NODE) return 0;
  const entry = flat.nodes.find((e) => e.node === node);
  if (!entry) return 0;
  return entry.base + offset;
}

/**
 * Given a target rendered text (`exact`) and an approximate position in the
 * rendered string, find the matching DOM Range. Used by the highlight layer
 * to place overlays at the resolved anchor positions.
 *
 * Strategy: search the flattened text for `exact`. If multiple matches, pick
 * the occurrence whose flat-index is closest to `approxStart`.
 */
export function locateRangeForText(
  root: HTMLElement,
  exact: string,
  approxStart?: number,
): Range | null {
  if (!exact) return null;
  const flat = renderedTextWithMap(root);
  if (flat.text.length === 0 || flat.nodes.length === 0) return null;

  const occurrences: number[] = [];
  let from = 0;
  while (from <= flat.text.length) {
    const idx = flat.text.indexOf(exact, from);
    if (idx < 0) break;
    occurrences.push(idx);
    from = idx + Math.max(1, exact.length);
  }
  if (occurrences.length === 0) return null;

  let chosen = occurrences[0];
  if (typeof approxStart === 'number') {
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const occ of occurrences) {
      const d = Math.abs(occ - approxStart);
      if (d < bestDelta) {
        bestDelta = d;
        chosen = occ;
      }
    }
  }

  const startPos = flatIndexToNodeOffset(flat, chosen);
  const endPos = flatIndexToNodeOffset(flat, chosen + exact.length);
  if (!startPos || !endPos) return null;

  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  return range;
}

function flatIndexToNodeOffset(
  flat: FlatTextMap,
  flatIndex: number,
): { node: Text; offset: number } | null {
  for (let i = 0; i < flat.nodes.length; i += 1) {
    const entry = flat.nodes[i];
    const next = flat.nodes[i + 1];
    const end = next ? next.base : flat.text.length;
    if (flatIndex <= end) {
      return { node: entry.node, offset: flatIndex - entry.base };
    }
  }
  // Fallback — push to end of last node.
  const last = flat.nodes[flat.nodes.length - 1];
  return last ? { node: last.node, offset: last.node.data.length } : null;
}
