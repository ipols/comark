# comark

Markdown review companion for Claude Code. Comment on agent-generated docs, get inline LLM answers, persist comments across sessions.

> **Status:** V1 in progress. This README is a skeleton; the full install + usage docs land with U9 of the implementation plan.

## What it does

When the agent in your Claude Code session writes a substantive markdown file (a PRD, brainstorm, plan, learnings doc), `comark` opens a review surface in your browser. You can:

- Highlight text or hover a paragraph to leave a comment
- Get inline LLM answers in the comment thread (with the same model your chat session is using, when detectable)
- Accept / refuse / continue the conversation per comment
- Reopen the doc later and find your comments still anchored, even if the agent has rewritten parts

Comment state lives in a `<doc>.comark.json` sidecar next to the source markdown — no database, no hosted backend, no auth.

## Install

```sh
# Add this marketplace
/plugin marketplace add iskanderpols/comark

# Install the plugin
/plugin install comark@iskanderpols-comark

# Set your Anthropic API key (one-time)
export ANTHROPIC_API_KEY=sk-...
```

After this, when the agent writes any markdown file ≥ 200 chars, you'll see a review URL surfaced in chat. Click it.

## Status

Under active development. See [docs/plans/](docs/plans/) for the implementation plan, [docs/brainstorms/](docs/brainstorms/) for the requirements doc.

## License

MIT. Includes a port of Hypothesis client's `match-quote` algorithm under BSD-2-Clause — see [LICENSE](LICENSE).
