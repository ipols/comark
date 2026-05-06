#!/usr/bin/env node
// comark MCP server — stdio transport.
//
// Exposes tools the chat agent (or its background listener subagent) calls
// to participate in the review loop:
//   - comark_wait_for_pending_comment: long-poll, returns next pending comment
//   - comark_post_answer: write the assistant turn back into the sidecar
//   - comark_get_chat_context: fresh transcript-derived summary + current model
//   - comark_list_comments: full state of a doc's comments
//   - comark_recent_activity: what's changed since timestamp
//   - comark_active_docs: which docs comark currently has registered
//
// Process model: this MCP server runs as a child process spawned by Claude Code
// (declared in plugin.json). It coordinates with the comark HTTP server (which
// the hook spawns when a markdown file is written) via the shared registry at
// ~/.comark/docs.json. Sidecar files (<doc>.comark.json) are the message bus.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  waitForPendingComment,
  postAnswer,
  getChatContext,
  listComments,
  recentActivity,
  listActiveDocs,
} from './tools.js';

const VERSION = '0.1.0';

function jsonResult(value) {
  return {
    content: [
      { type: 'text', text: JSON.stringify(value, null, 2) },
    ],
  };
}

async function main() {
  const server = new McpServer(
    { name: 'comark', version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'comark_wait_for_pending_comment',
    {
      title: 'Wait for next pending comark comment',
      description:
        'Long-poll for the next user comment in any active comark doc that is awaiting an assistant answer. Blocks for up to `timeout_ms` milliseconds (default 60000, max 300000) and returns the comment bundle when one arrives, or `{status: "timeout"}` if none arrived in time. Use this in a listener loop: call it, generate an answer when it returns, post via comark_post_answer, then call it again. The returned bundle includes the doc content, the highlighted selection, the user comment text, the prior thread, and the chat model the doc was registered with.',
      inputSchema: {
        timeout_ms: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Milliseconds to block before timing out. Default 60000, max 300000.'),
        doc_path: z
          .string()
          .optional()
          .describe('Restrict to a specific doc by absolute path. Defaults to all active docs.'),
      },
    },
    async (args) => jsonResult(
      await waitForPendingComment({ timeoutMs: args.timeout_ms, docPath: args.doc_path }),
    ),
  );

  server.registerTool(
    'comark_post_answer',
    {
      title: 'Post the assistant answer for a pending comark comment',
      description:
        'Write your generated answer back into the comment thread for `comment_id`. Updates the sidecar atomically; the user\'s browser tab picks it up via SSE within ~100ms and renders it in place of the "thinking" indicator. Side-effects: appends an assistant turn with state=complete; sets the comment uiState to "answer-ready"; clears any prior error.',
      inputSchema: {
        comment_id: z.string().describe('The id from comark_wait_for_pending_comment.'),
        text: z.string().min(1).describe('The full answer text. Markdown is rendered.'),
      },
    },
    async (args) => jsonResult(
      await postAnswer({ commentId: args.comment_id, text: args.text }),
    ),
  );

  server.registerTool(
    'comark_get_chat_context',
    {
      title: 'Get the chat-session context for an active doc',
      description:
        'Returns a fresh summary of the chat session that registered this doc — recent decisions, source files referenced, open questions, and the current chat model. Re-reads the transcript every call so the listener is always up-to-date with what the main chat agent has been discussing. Pass a doc_path to scope; otherwise uses the most-recently-registered doc.',
      inputSchema: {
        doc_path: z.string().optional().describe('Absolute path to scope context to a specific doc.'),
      },
    },
    async (args) => jsonResult(await getChatContext({ docPath: args.doc_path })),
  );

  server.registerTool(
    'comark_list_comments',
    {
      title: 'List all comments on an active comark doc',
      description:
        'Read-only snapshot of all comments + threads + states for the given doc (or every active doc if doc_path omitted). Use this when the user asks "address my feedback" or "summarize what we discussed in the review."',
      inputSchema: {
        doc_path: z.string().optional(),
      },
    },
    async (args) => jsonResult(await listComments({ docPath: args.doc_path })),
  );

  server.registerTool(
    'comark_recent_activity',
    {
      title: 'List comments updated since a timestamp',
      description:
        'Surface review activity for the chat. Pass `since` as an ISO 8601 timestamp; comments updated after that are returned, sorted most-recent first. Default scope is all active docs.',
      inputSchema: {
        since: z.string().optional().describe('ISO 8601 timestamp; default returns everything.'),
        doc_path: z.string().optional(),
      },
    },
    async (args) => jsonResult(
      await recentActivity({ since: args.since, docPath: args.doc_path }),
    ),
  );

  server.registerTool(
    'comark_active_docs',
    {
      title: 'List docs comark currently knows about',
      description:
        'Returns each doc the hook has registered: docId, absolute path, registration timestamp, and chat model. Empty when comark has not been triggered this session.',
      inputSchema: {},
    },
    async () => jsonResult(await listActiveDocs()),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now listening; MCP host will drive it.
}

main().catch((err) => {
  process.stderr.write(`comark-mcp: fatal startup error: ${err?.stack || err?.message || err}\n`);
  process.exit(1);
});
