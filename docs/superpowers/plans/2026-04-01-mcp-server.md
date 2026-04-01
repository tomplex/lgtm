# MCP Server Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount an MCP server on the existing Express app at `/mcp` with six tools for managing review sessions.

**Architecture:** New `server/mcp.ts` module creates an McpServer, registers tools, and mounts Streamable HTTP transport on the Express app. Tools are thin wrappers around the existing SessionManager and Session methods. SessionManager gets a `findByRepoPath` helper.

**Tech Stack:** `@modelcontextprotocol/sdk`, `zod`, Express, existing SessionManager/Session

**Spec:** `docs/superpowers/specs/2026-04-01-mcp-server-design.md`

---

### Task 1: Install MCP dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
npm install @modelcontextprotocol/sdk zod
```

Note: skip `@modelcontextprotocol/express` for now — we'll handle the Express mounting manually with the SDK's `NodeStreamableHTTPServerTransport`. The express adapter may add complexity we don't need.

- [ ] **Step 2: Verify TypeScript can find the types**

Create a temporary test file `server/_test-mcp.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const server = new McpServer({ name: 'test', version: '0.1.0' });
server.tool('ping', { message: z.string() }, async ({ message }) => ({
  content: [{ type: 'text', text: `pong: ${message}` }],
}));

console.log('MCP SDK imports work');
```

Run: `npx tsx server/_test-mcp.ts`
Expected: prints "MCP SDK imports work" (no import errors).

Delete `server/_test-mcp.ts` after verifying.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "add MCP SDK and zod dependencies"
```

---

### Task 2: Add findByRepoPath to SessionManager

**Files:**
- Modify: `server/session-manager.ts`

- [ ] **Step 1: Add the findByRepoPath method**

In `server/session-manager.ts`, add this public method to the `SessionManager` class, after the `get()` method:

```typescript
  findByRepoPath(repoPath: string): { slug: string; session: Session } | undefined {
    const absPath = resolve(repoPath);
    for (const [slug, session] of this._sessions) {
      if (session.repoPath === absPath) {
        return { slug, session };
      }
    }
    return undefined;
  }
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/session-manager.ts
git commit -m "add findByRepoPath to SessionManager"
```

---

### Task 3: Create MCP server module with all tools

**Files:**
- Create: `server/mcp.ts`

- [ ] **Step 1: Create server/mcp.ts**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import type express from 'express';
import type { SessionManager } from './session-manager.js';

function createMcpServer(manager: SessionManager): McpServer {
  const server = new McpServer({
    name: 'lgtm',
    version: '0.1.0',
  });

  // --- Tools ---

  server.tool(
    'review_start',
    'Register a project for code review and get the browser URL',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
      description: z.string().optional().describe('Review context shown as a banner'),
      baseBranch: z.string().optional().describe('Base branch (auto-detected if omitted)'),
    },
    async ({ repoPath, description, baseBranch }) => {
      const result = manager.register(repoPath, { description, baseBranch });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result),
        }],
      };
    },
  );

  server.tool(
    'review_add_document',
    'Add a document tab to a review session',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
      path: z.string().describe('Absolute path to the document file'),
      title: z.string().optional().describe('Tab title (defaults to filename)'),
    },
    async ({ repoPath, path, title }) => {
      const found = manager.findByRepoPath(repoPath);
      if (!found) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Project not registered. Call review_start first.' }) }] };
      }
      const itemTitle = title || path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled';
      const itemId = itemTitle.toLowerCase().replace(/[ /]/g, '-').slice(0, 40);
      const result = found.session.addItem(itemId, itemTitle, path);
      found.session.broadcast('items_changed', { id: itemId });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'review_comment',
    'Add Claude comments to a review item (diff or document)',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
      item: z.string().optional().describe('Item ID to comment on (default: "diff")'),
      comments: z.array(z.object({
        file: z.string().optional().describe('File path within the repo (for diff comments)'),
        line: z.number().optional().describe('Line number (for diff comments)'),
        block: z.number().optional().describe('Block index (for document comments)'),
        comment: z.string().describe('The comment text'),
      })).describe('Array of comments to add'),
    },
    async ({ repoPath, item, comments }) => {
      const found = manager.findByRepoPath(repoPath);
      if (!found) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Project not registered. Call review_start first.' }) }] };
      }
      const itemId = item ?? 'diff';
      const count = found.session.addComments(itemId, comments);
      found.session.broadcast('comments_changed', { item: itemId, count: comments.length });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, count }) }] };
    },
  );

  server.tool(
    'review_status',
    'List all registered review projects and their feedback status',
    {},
    async () => {
      const projects = manager.list().map(p => {
        const session = manager.get(p.slug)!;
        let hasFeedback = false;
        let feedbackRounds = 0;
        try {
          const content = readFileSync(session.outputPath, 'utf-8');
          hasFeedback = content.trim().length > 0;
          const signalPath = session.outputPath + '.signal';
          if (existsSync(signalPath)) {
            feedbackRounds = parseInt(readFileSync(signalPath, 'utf-8').trim()) || 0;
          }
        } catch {
          // file doesn't exist yet
        }
        return { ...p, hasFeedback, feedbackRounds };
      });
      return { content: [{ type: 'text', text: JSON.stringify({ projects }) }] };
    },
  );

  server.tool(
    'review_read_feedback',
    'Read the submitted review feedback for a project',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
    },
    async ({ repoPath }) => {
      const found = manager.findByRepoPath(repoPath);
      if (!found) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Project not registered. Call review_start first.' }) }] };
      }
      let feedback = '';
      try {
        feedback = readFileSync(found.session.outputPath, 'utf-8');
      } catch {
        // no feedback yet
      }
      return { content: [{ type: 'text', text: feedback || 'No feedback submitted yet.' }] };
    },
  );

  server.tool(
    'review_stop',
    'Deregister a project and stop its review session',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
    },
    async ({ repoPath }) => {
      const found = manager.findByRepoPath(repoPath);
      if (!found) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Project not registered.' }) }] };
      }
      manager.deregister(found.slug);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, slug: found.slug }) }] };
    },
  );

  return server;
}

export function mountMcp(app: express.Express, manager: SessionManager): void {
  // Track transports by session ID for stateful connections
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post('/mcp', async (req, res) => {
    // Check for existing session
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session — create server + transport
    const mcpServer = createMcpServer(manager);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) transports.delete(sid);
    };

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);

    if (transport.sessionId) {
      transports.set(transport.sessionId, transport);
    }
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Missing or invalid MCP-Session-Id header' });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      transports.delete(sessionId);
    } else {
      res.status(400).json({ error: 'Missing or invalid MCP-Session-Id header' });
    }
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: No errors.

IMPORTANT: The MCP SDK's import paths may differ from what's shown above. If imports fail, check the actual package structure:
- Try `@modelcontextprotocol/sdk/server/mcp.js` first
- If that fails, try `@modelcontextprotocol/sdk/server/mcp`
- Check `node_modules/@modelcontextprotocol/sdk/` for the actual export paths
- The transport class might be `StreamableHTTPServerTransport` or `NodeStreamableHTTPServerTransport` — check the package exports

Fix any import paths until compilation passes.

- [ ] **Step 3: Commit**

```bash
git add server/mcp.ts
git commit -m "add MCP server module with review tools"
```

---

### Task 4: Mount MCP on the Express app

**Files:**
- Modify: `server/server.ts`

- [ ] **Step 1: Add mountMcp call in server.ts**

In `server/server.ts`, add the import at the top:

```typescript
import { mountMcp } from './mcp.js';
```

Then add the mount call after `createApp(manager)` but before `app.listen()`:

```typescript
  const manager = new SessionManager(port);
  const app = createApp(manager);
  mountMcp(app, manager);  // <-- add this line
  const url = `http://127.0.0.1:${port}`;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/server.ts
git commit -m "mount MCP endpoint on Express app"
```

---

### Task 5: End-to-end verification

**Files:**
- No new files

- [ ] **Step 1: Start the server**

```bash
npx tsx server/server.ts --port 9900 &
```

Wait for `LGTM_URL=http://127.0.0.1:9900` output.

- [ ] **Step 2: Test MCP initialization**

Send an MCP initialize request:

```bash
curl -s -X POST http://127.0.0.1:9900/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": { "name": "test", "version": "0.1.0" }
    }
  }'
```

Expected: JSON response with server capabilities and a `MCP-Session-Id` header. Save the session ID for subsequent requests.

- [ ] **Step 3: Test tools/list**

```bash
curl -s -X POST http://127.0.0.1:9900/mcp \
  -H 'Content-Type: application/json' \
  -H 'MCP-Session-Id: <session-id-from-step-2>' \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```

Expected: JSON response listing all six tools: `review_start`, `review_add_document`, `review_comment`, `review_status`, `review_read_feedback`, `review_stop`.

- [ ] **Step 4: Test review_start tool**

```bash
curl -s -X POST http://127.0.0.1:9900/mcp \
  -H 'Content-Type: application/json' \
  -H 'MCP-Session-Id: <session-id>' \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "review_start",
      "arguments": {
        "repoPath": "/Users/tom/dev/claude-review",
        "description": "MCP test"
      }
    }
  }'
```

Expected: response containing `{ slug: "claude-review", url: "http://127.0.0.1:9900/project/claude-review/" }`.

- [ ] **Step 5: Test review_status tool**

```bash
curl -s -X POST http://127.0.0.1:9900/mcp \
  -H 'Content-Type: application/json' \
  -H 'MCP-Session-Id: <session-id>' \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "review_status",
      "arguments": {}
    }
  }'
```

Expected: response listing the registered project with `hasFeedback: false`.

- [ ] **Step 6: Test review_comment tool**

```bash
curl -s -X POST http://127.0.0.1:9900/mcp \
  -H 'Content-Type: application/json' \
  -H 'MCP-Session-Id: <session-id>' \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "review_comment",
      "arguments": {
        "repoPath": "/Users/tom/dev/claude-review",
        "comments": [{"file": "server/mcp.ts", "line": 1, "comment": "MCP integration looks good"}]
      }
    }
  }'
```

Expected: `{ ok: true, count: 1 }`.

Open the browser to `http://127.0.0.1:9900/project/claude-review/` and verify the Claude comment appears on the diff.

- [ ] **Step 7: Test review_read_feedback and review_stop**

```bash
# Read feedback (should be empty)
curl -s -X POST http://127.0.0.1:9900/mcp \
  -H 'Content-Type: application/json' \
  -H 'MCP-Session-Id: <session-id>' \
  -d '{
    "jsonrpc": "2.0",
    "id": 6,
    "method": "tools/call",
    "params": {
      "name": "review_read_feedback",
      "arguments": { "repoPath": "/Users/tom/dev/claude-review" }
    }
  }'

# Stop
curl -s -X POST http://127.0.0.1:9900/mcp \
  -H 'Content-Type: application/json' \
  -H 'MCP-Session-Id: <session-id>' \
  -d '{
    "jsonrpc": "2.0",
    "id": 7,
    "method": "tools/call",
    "params": {
      "name": "review_stop",
      "arguments": { "repoPath": "/Users/tom/dev/claude-review" }
    }
  }'
```

Expected: feedback returns "No feedback submitted yet.", stop returns `{ ok: true }`.

Kill the background server when done.

- [ ] **Step 8: Commit any fixes**

```bash
git add server/
git commit -m "fix MCP integration issues from testing"
```
