// Transcript reader → context summary + model identifier.
//
// Reads the JSONL transcript at $transcript_path, walks the last ~30 turns,
// and extracts:
//   - Current model (most recent assistant turn's `message.model`)
//   - Source files referenced (file_path inputs to recent Read/Write/Edit tool_use)
//   - Recent decisions (first sentences of recent assistant text turns)
//   - Open questions (sentences ending in `?` in recent assistant text)
//
// All extraction is heuristic and bounded — the hook script must complete
// well within its timeout, so we read the file once and process line by line.

import { readFile } from 'node:fs/promises';

const TURN_WINDOW = 30; // last N events scanned
const SUMMARY_TEXT_TURNS = 4; // assistant turns whose text feeds the summary
const MAX_FILES = 12;
const MAX_QUESTIONS = 6;

export async function buildContextSummary(transcriptPath) {
  if (!transcriptPath) return { summary: null, model: null };

  let raw;
  try {
    raw = await readFile(transcriptPath, 'utf8');
  } catch {
    return { summary: null, model: null };
  }

  const lines = raw.split('\n').filter(Boolean);
  const tail = lines.slice(-TURN_WINDOW * 4); // each turn can produce multiple events; over-fetch + filter
  const events = [];
  for (const line of tail) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  let model = null;
  const filesSeen = new Set();
  const assistantTexts = [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (!ev || typeof ev !== 'object') continue;

    if (ev.type === 'assistant') {
      // Model field — most recent wins because we walk backwards.
      if (!model && typeof ev.model === 'string') model = ev.model;
      if (!model && typeof ev.message?.model === 'string') model = ev.message.model;

      // Text + tool_use blocks.
      const blocks = ev.message?.content;
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            if (assistantTexts.length < SUMMARY_TEXT_TURNS) assistantTexts.push(block.text);
          } else if (block?.type === 'tool_use' && block.input) {
            const fp = block.input.file_path || block.input.path;
            if (typeof fp === 'string' && filesSeen.size < MAX_FILES) filesSeen.add(fp);
          }
        }
      }
    } else if (ev.type === 'user') {
      // tool_results sometimes carry referenced file paths in their content.
      const content = ev.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_result' && typeof block.content === 'string') {
            // No file extraction here — too noisy to be useful.
          }
        }
      }
    }
  }

  // Compose summary.
  const sections = [];

  if (filesSeen.size > 0) {
    sections.push(
      `**Source files referenced (most recent):**\n` +
        [...filesSeen].slice(0, MAX_FILES).map((p) => `- ${p}`).join('\n'),
    );
  }

  if (assistantTexts.length > 0) {
    const decisions = assistantTexts
      .reverse() // chronological order
      .map((t) => firstSentence(t))
      .filter(Boolean)
      .slice(-SUMMARY_TEXT_TURNS);
    if (decisions.length > 0) {
      sections.push(
        `**Recent assistant turns (first sentence each):**\n` +
          decisions.map((d) => `- ${d}`).join('\n'),
      );
    }

    const questions = assistantTexts
      .flatMap((t) => extractQuestions(t))
      .slice(-MAX_QUESTIONS);
    if (questions.length > 0) {
      sections.push(
        `**Open questions surfaced recently:**\n` +
          questions.map((q) => `- ${q}`).join('\n'),
      );
    }
  }

  if (model) {
    sections.push(`**Current chat model:** \`${model}\``);
  }

  const summary = sections.length > 0 ? sections.join('\n\n') : null;
  return { summary, model };
}

function firstSentence(text) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  // First sentence-ish: stop at . ! ? newline, capped at 200 chars.
  const match = trimmed.match(/^[\s\S]{1,200}?[.!?](\s|$)|^[\s\S]{1,200}/);
  return (match ? match[0] : trimmed.slice(0, 200)).replace(/\s+/g, ' ').trim();
}

function extractQuestions(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  // Match sentences ending in `?`. Bounded to 200 chars.
  const re = /[^.!?\n]{5,200}\?/g;
  let m;
  while ((m = re.exec(text)) !== null && out.length < MAX_QUESTIONS) {
    out.push(m[0].trim().replace(/\s+/g, ' '));
  }
  return out;
}
