/*
 * rehype plugin that copies each AST node's `position` (start/end offsets in
 * the original markdown source) to a `data-sourcepos` attribute on the
 * rendered HTML element. The SPA's selection.ts uses this to project a
 * rendered DOM Range back to source-character offsets.
 *
 * Format: data-sourcepos="<start>:<end>" — half-open in source-character
 * offsets after upstream remark parsing. This is the source-position field
 * the planner referenced in U5/U6 — implemented locally because no widely
 * published rehype plugin emits these offsets.
 *
 * The visit pattern mirrors the one used by remark-rehype source-mapping
 * code; we keep the implementation tiny and dependency-free beyond `unist-util-visit`.
 */

import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, Element } from 'hast';

type ElementWithPosition = Element & {
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

const rehypeSourcePosition: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'element', (node: ElementWithPosition) => {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (typeof start === 'number' && typeof end === 'number') {
        if (!node.properties) node.properties = {};
        // Already set by an upstream pass — don't overwrite (we run last).
        if (typeof node.properties['data-sourcepos'] === 'undefined') {
          node.properties['data-sourcepos'] = `${start}:${end}`;
        }
      }
    });
  };
};

export default rehypeSourcePosition;
