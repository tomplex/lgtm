# Claude Code Channels — Research Notes

Research from 2026-04-01 on how to push notifications from LGTM to Claude Code when a user submits review feedback.

## What are channels?

Channels are MCP servers that push events into a running Claude Code session. Claude sees them as `<channel>` XML tags in its context. They're the push counterpart to MCP tools (which are pull — Claude calls them).

## How they work

1. The channel server (an MCP server) receives an event from an external source
2. The channel server calls `mcp.notification()` with method `notifications/claude/channel`
3. Claude Code receives the notification and injects it into Claude's context as XML

```typescript
await mcp.notification({
  method: 'notifications/claude/channel',
  params: {
    content: 'the event body as a string',
    meta: {
      key1: 'value1',  // becomes XML attributes
    }
  }
});
```

Claude sees:
```xml
<channel source="your-channel-name" key1="value1">
the event body as a string
</channel>
```

## Key constraints

- **Only TypeScript/JS SDK** — the Python MCP SDK does not support `notifications/claude/channel`. This was the primary reason we migrated the backend to TypeScript.
- **Cannot push from a non-MCP process** — an external HTTP server can't notify Claude directly. It must go through an MCP server.
- **Two-way channels** — the channel server can expose a reply tool so Claude can respond back through the channel. Uses standard MCP tool discovery (`ListToolsRequestSchema`).
- **Claude Code v2.1.80+** required, with `claude.ai` login (not Console/API key auth)
- **Custom channels during research preview** need `--dangerously-load-development-channels` flag or Anthropic approval
- **Team/Enterprise** needs admin to enable `channelsEnabled: true`

## Transport

Channels can work over both stdio and HTTP transports. Since LGTM uses Streamable HTTP (MCP at `/mcp` on the same Express server), the channel notifications would go out over the same HTTP connection.

The Streamable HTTP transport uses SSE for server→client notifications. When LGTM sends a channel notification, it flows back to Claude Code via the existing SSE stream on the MCP connection.

## LGTM integration plan

Since LGTM's MCP server and HTTP server are the same process, the notification path is straightforward:

1. User clicks "Submit Review" in the browser
2. Express `POST /project/:slug/submit` handler calls `session.submitReview()`
3. The submit handler (or session) also fires a channel notification via the MCP server
4. Claude sees the feedback in its context immediately

The tricky part: the Express route handler needs access to the MCP server instance to send the notification. Options:
- Pass the MCP server (or a notification callback) into the session or app
- Have the session emit an event that the MCP layer listens to
- Store a reference to active MCP transports and broadcast to them

The cleanest approach is probably an event emitter on Session — `session.on('review_submitted', callback)` — and the MCP layer subscribes when a transport is created.

## Notification payload for review submit

When a user submits a review, the channel notification should contain the formatted review feedback (the same markdown that gets written to the output file). This way Claude can read and act on it without calling `review_read_feedback`.

```typescript
mcp.notification({
  method: 'notifications/claude/channel',
  params: {
    content: formattedReviewMarkdown,
    meta: {
      event: 'review_submitted',
      project: slug,
      round: currentRound.toString(),
    }
  }
});
```

## Resolved questions

- **Streamable HTTP transport works.** Confirmed 2026-04-02. The MCP server declares `experimental: { 'claude/channel': {} }` in capabilities, and `server.notification()` pushes through the SSE stream. Claude Code receives `<channel>` tags as expected. Requires `--dangerously-load-development-channels server:lgtm` flag during research preview.

## Open questions

- What happens if multiple Claude sessions are connected to the same MCP server? Do all of them get the notification?
- Is there a way to target a specific Claude session with a notification?
- How does the `instructions` field on the channel server work with HTTP transport? (For stdio channels, the instructions tell Claude what the channel events mean.)
