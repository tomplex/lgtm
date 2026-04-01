# Phase 3: MCP Server Integration

Mount an MCP server on the existing Express app so Claude Code can manage review sessions natively through tools rather than HTTP calls.

## Motivation

Currently Claude interacts with LGTM by shelling out to start the server and using curl to hit the HTTP API. With MCP, Claude has native tool access — `review_start`, `review_comment`, `review_read_feedback`, etc. — discoverable and typed. This is the core integration that makes LGTM a first-class Claude Code tool.

## Architecture

The MCP server runs on the same Express app, same port, mounted at `/mcp`. Claude Code connects via Streamable HTTP transport. The MCP tools are thin wrappers around SessionManager and Session methods — no new business logic.

```
Express app (port 9900)
├── /mcp              ← Claude Code (MCP Streamable HTTP)
├── /projects         ← Project management API
├── /project/:slug/*  ← Browser API routes + SSE
└── /                 ← Static files (frontend/dist)
```

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server, tools, Streamable HTTP transport
- `@modelcontextprotocol/express` — Express integration with DNS rebinding protection
- `zod` — schema validation for tool inputs (required by MCP SDK)

## MCP Tools

### review_start

Registers a project and returns the browser URL.

Input:
- `repoPath` (string, required) — absolute path to git repo
- `description` (string, optional) — review context banner
- `baseBranch` (string, optional) — auto-detected if omitted

Output: `{ slug, url }` — the project slug and browser URL

Behavior: calls `manager.register()`. Idempotent — re-registering the same path returns the existing session.

### review_add_document

Adds a document tab to a project's review session.

Input:
- `repoPath` (string, required) — identifies the project
- `path` (string, required) — absolute path to the document file
- `title` (string, optional) — tab title, defaults to filename stem

Output: `{ ok, id, items }` — the item ID and updated items list

Behavior: resolves repoPath to a session, calls `session.addItem()`.

### review_comment

Seeds Claude's comments on a review item.

Input:
- `repoPath` (string, required) — identifies the project
- `item` (string, optional, default "diff") — item ID to comment on
- `comments` (array of `{ file?, line?, block?, comment }`) — the comments

Output: `{ ok, count }` — total comment count for the item

Behavior: resolves repoPath to a session, calls `session.addComments()`, broadcasts SSE event.

### review_status

Lists all registered projects with feedback status.

Input: none

Output: `{ projects: Array<{ slug, repoPath, description, hasFeedback, feedbackRounds }> }`

Behavior: iterates `manager.list()`, checks each project's output file for content and signal file for round count.

### review_read_feedback

Reads the submitted review feedback for a project.

Input:
- `repoPath` (string, required) — identifies the project

Output: `{ feedback }` — the contents of the review output file, or empty string if no feedback yet

Behavior: resolves repoPath to a session, reads the output file.

### review_stop

Deregisters a project.

Input:
- `repoPath` (string, required) — identifies the project

Output: `{ ok }`

Behavior: resolves repoPath to a slug, calls `manager.deregister()`.

## File changes

### New: server/mcp.ts

Creates the MCP server, registers all six tools, exports a mount function.

```typescript
export function mountMcp(app: Express, manager: SessionManager): void
```

This function:
1. Creates an `McpServer` instance
2. Registers all tools (each tool closure captures `manager`)
3. Sets up `NodeStreamableHTTPServerTransport` with session management
4. Mounts POST and GET handlers at `/mcp` on the Express app

### Modified: server/session-manager.ts

Add a public method to look up a session by repo path:

```typescript
findByRepoPath(repoPath: string): { slug: string; session: Session } | undefined
```

This extracts the existing path-matching logic from `register()` into a reusable method.

### Modified: server/server.ts

After `createApp(manager)`, call `mountMcp(app, manager)` before `app.listen()`.

### Modified: package.json

Add dependencies: `@modelcontextprotocol/sdk`, `@modelcontextprotocol/express`, `zod`.

## Claude Code configuration

Users add the MCP server in their Claude Code settings:

```bash
claude mcp add --transport http lgtm http://localhost:9900/mcp
```

Or in the project's `.mcp.json`:
```json
{
  "mcpServers": {
    "lgtm": {
      "type": "http",
      "url": "http://localhost:9900/mcp"
    }
  }
}
```

The LGTM server must be running for Claude to connect.

## Out of scope

- Channel notifications on review submit (fast follow — add `sendLoggingMessage` or `notifications/claude/channel` call in `submitReview`)
- "Ask Claude" button (depends on channels)
- Stable comment IDs (independent work item)
- Plugin packaging (separate concern — wraps the MCP config, skills, and server startup)
