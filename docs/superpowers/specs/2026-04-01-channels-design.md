# LGTM Channels — Design Spec

Push notifications from LGTM to Claude Code via MCP channel notifications, enabling two interactions that bypass polling:

1. **Review submitted** — user submits a review round, Claude gets the feedback immediately
2. **Direct question** — user asks Claude a question on a specific line/block, Claude replies inline

**Prerequisite:** Unified comment model (see `2026-04-01-unified-comments-design.md`). This spec builds on the `Comment` type with `author` and `mode` fields defined there.

## Channel Notification Infrastructure

### Transport registry

`mountMcp` in `mcp.ts` already tracks active `StreamableHTTPServerTransport` instances in a `transports` Map. Extend this to also track the associated `McpServer` instance for each transport.

Export a `notifyChannel(content: string, meta: Record<string, string>)` function from `mcp.ts` that iterates all active McpServer/transport pairs and sends `notifications/claude/channel` on each.

```typescript
// In mcp.ts
const activeSessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

export function notifyChannel(content: string, meta: Record<string, string>): void {
  for (const { server } of activeSessions.values()) {
    server.notification({
      method: 'notifications/claude/channel',
      params: { content, meta },
    });
  }
}
```

The Express route handlers in `app.ts` import and call `notifyChannel` — no event emitter indirection needed.

### Channel metadata convention

All notifications include `source: "lgtm"` (set by MCP channel config). Additional meta fields per event type:

- `event`: `"review_submitted"` or `"question"`
- `project`: the session slug
- `round`: review round number (for `review_submitted`)
- `file`, `line`: location context (for `question`)

## Event 1: Review Submitted

Triggered in the `POST /project/:slug/submit` route after `session.submitReview()` succeeds.

**Payload:**
```
meta: { event: "review_submitted", project: slug, round: "N" }
content: the formatted review markdown (same as written to the output file)
```

This replaces the need for Claude to poll with `read_feedback`. The existing `read_feedback` MCP tool stays available as a fallback (e.g., if the channel connection dropped).

**No changes to the frontend submission flow.** The channel notification is purely server-side, fired from the Express route handler after `submitReview()`.

## Event 2: Direct Question ("Ask Claude")

### Frontend

New "Ask Claude" button appears alongside existing comment actions on diff lines and document blocks. When clicked:

1. Opens a textarea (reusing the existing textarea/save/cancel pattern)
2. User types their question
3. On save, posts to `POST /project/:slug/ask` instead of saving to local state
4. The question renders inline with distinct styling — "You" label, "Ask Claude" badge, waiting-for-reply indicator

When Claude's reply arrives via SSE (`reply_added` event):
- The reply renders beneath the question using the same thread rendering as other comment replies, but with "Claude" label

### Server

**New route: `POST /project/:slug/ask`**

```
Body: { item: string, file?: string, line?: number, block?: number, text: string }
```

- Creates a `Comment` with `author: 'user', mode: 'direct'`
- Stores it in the session
- Calls `notifyChannel()` with the question text and location context
- Broadcasts `question_added` via SSE to update the browser UI
- Returns `{ ok: true, id: commentId }`

**Channel notification payload:**
```
meta: { event: "question", project: slug, file: "src/foo.ts", line: "42" }
content: |
  Question on src/foo.ts:42:

  <the user's question text>

  Context:
  <a few surrounding lines of code>
```

The content includes surrounding code lines so Claude has context without needing to read the file.

### Reply path

**New MCP tool: `reply`**

```
Parameters:
  repoPath: string    — identifies the session
  commentId: string   — the comment to reply to
  text: string        — Claude's reply
```

- Looks up the session and the parent comment by ID
- Creates a new `Comment` with `author: 'claude', parentId: commentId`
- Persists and broadcasts `reply_added` via SSE
- Returns `{ ok: true, id: replyId }`

This tool works for replying to any comment, but in practice Claude will use it to answer direct questions.

## What stays the same

- Review comment flow — user leaves `mode: 'review'` comments, they accumulate, get submitted as a batch. Channel notification fires with `event: 'review_submitted'` carrying the full review markdown.
- Claude seeded comments — Claude uses the existing `comment` MCP tool. User can reply/resolve/dismiss.
- `read_feedback` MCP tool — stays as a fallback.
- SSE infrastructure — existing broadcast mechanism, just new event types (`question_added`, `reply_added`).

## What changes

- **`mcp.ts`** — transport registry expanded, `notifyChannel` exported
- **`app.ts`** — `POST /submit` calls `notifyChannel` after submit; new `POST /ask` route
- **MCP tools** — new `reply` tool
- **Frontend** — "Ask Claude" button/textarea on lines, direct question rendering, reply-via-SSE handling

## Open questions from research

These are from `docs/channels-research.md` and still need answers before or during implementation:

- Does `notifications/claude/channel` work with Streamable HTTP transport, or only stdio?
- What happens if multiple Claude sessions connect to the same MCP server? Do all get the notification?
- Is there a way to target a specific Claude session?
- How does the `instructions` field work with HTTP transport?

The first question is a blocker — if HTTP transport doesn't support channel notifications, we need a workaround (possibly a separate stdio MCP server just for channels). The others affect multi-session behavior but aren't blockers for a single-session MVP.
