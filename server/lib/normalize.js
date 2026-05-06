// Text normalization for anchor resolution.
// Per W3C charmod-norm: NFC Unicode form + line-ending → \n.
// Whitespace collapse is a separate concern: anchor algorithms compare on
// normalized-whitespace text; the SPA still renders source as-authored.

export function normalizeForAnchor(text) {
  if (typeof text !== 'string') return '';
  // 1. Line endings: CRLF / CR → LF.
  let out = text.replace(/\r\n?/g, '\n');
  // 2. NFC normalization (visual-equivalent characters compose).
  out = out.normalize('NFC');
  return out;
}

// "Anchor-comparison form": for fuzzy matching across whitespace edits,
// collapse runs of whitespace to a single space. Markdown source structure
// (headings, lists) loses meaning here — that's intentional; anchors are
// about the prose, not the syntax.
export function normalizeForFuzzyMatch(text) {
  if (typeof text !== 'string') return '';
  return normalizeForAnchor(text).replace(/\s+/g, ' ').trim();
}
