/*
 * Selection capture — listens to the document for user text selections inside
 * a designated root, computes anchor metadata, and surfaces it to the popup.
 */

import {
  capturePrefixSuffix,
  findSourceposAncestor,
  parseSourcepos,
  renderedTextWithMap,
} from './source-mapping';
import type { Selector } from '../types';

export type SelectionAnchor = {
  selectors: Selector[];
  rangeRect: DOMRect;
  exact: string;
  prefix: string;
  suffix: string;
};

const MIN_SELECTION_LEN = 1;

/** Compute SelectionAnchor from the current Window selection, or null if invalid. */
export function captureCurrentSelection(root: HTMLElement): SelectionAnchor | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);

  // Range must be entirely inside the doc surface root.
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }

  const text = range.toString();
  if (text.length < MIN_SELECTION_LEN) return null;

  const { exact, prefix, suffix } = capturePrefixSuffix(root, range);
  if (!exact || exact.trim().length === 0) return null;

  // Approximate source range from the nearest ancestor with data-sourcepos.
  const startEl = findSourceposAncestor(range.startContainer);
  const endEl = findSourceposAncestor(range.endContainer);
  const startPos = parseSourcepos(startEl);
  const endPos = parseSourcepos(endEl);

  // Refine: walk inside the start element and add the offset of the selection
  // start within the element's rendered text. Same for end.
  let approxStart = 0;
  let approxEnd = 0;
  if (startEl && startPos) {
    const offset = renderedOffsetWithin(startEl, range.startContainer, range.startOffset);
    approxStart = startPos.start + offset;
  }
  if (endEl && endPos) {
    const offset = renderedOffsetWithin(endEl, range.endContainer, range.endOffset);
    approxEnd = endPos.start + offset;
  }

  const selectors: Selector[] = [
    { type: 'TextQuoteSelector', exact, prefix, suffix },
    { type: 'TextPositionSelector', start: approxStart, end: approxEnd },
  ];

  return {
    selectors,
    rangeRect: range.getBoundingClientRect(),
    exact,
    prefix,
    suffix,
  };
}

/** Compute a paragraph-block anchor when the user clicks a hover affordance. */
export function captureBlockSelection(block: HTMLElement): SelectionAnchor | null {
  const range = document.createRange();
  range.selectNodeContents(block);
  const text = range.toString();
  if (!text.trim()) return null;

  const root = block.ownerDocument?.body || document.body;
  const { exact, prefix, suffix } = capturePrefixSuffix(root as HTMLElement, range);

  const pos = parseSourcepos(block);
  const start = pos?.start ?? 0;
  const end = pos?.end ?? exact.length;

  const selectors: Selector[] = [
    { type: 'TextQuoteSelector', exact, prefix, suffix },
    { type: 'TextPositionSelector', start, end },
  ];

  return { selectors, rangeRect: block.getBoundingClientRect(), exact, prefix, suffix };
}

/** Walk all text nodes inside `root` up to `(node, offset)` and count
 *  how many rendered characters precede that location. */
function renderedOffsetWithin(root: HTMLElement, node: Node, offset: number): number {
  if (node === root && node.nodeType === Node.ELEMENT_NODE) {
    // If the range start is the element itself, count up to its `offset` child.
    let count = 0;
    for (let i = 0; i < offset && i < (node as HTMLElement).childNodes.length; i += 1) {
      const child = (node as HTMLElement).childNodes[i];
      count += child.textContent?.length || 0;
    }
    return count;
  }
  if (!root.contains(node)) {
    // Range outside this element — just return 0, the caller already made
    // worst-case decisions for ancestor mismatch.
    return 0;
  }

  // Walk all text nodes; sum up to the target node, then add `offset`.
  const flat = renderedTextWithMap(root);
  for (const entry of flat.nodes) {
    if (entry.node === node) {
      return entry.base + offset;
    }
  }
  return 0;
}
