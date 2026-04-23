# MCP Auto-Init Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the explicit `start` MCP tool. Any MCP tool call auto-registers its project and (when no claim exists) grants diff-review notifications to the calling session. Fold `start`'s remaining responsibilities (description banner, baseBranch override, URL return) into `claim_reviews`.

**Architecture:** Rename `requireProject` → `resolveProject` in `server/mcp.ts`. The new function calls `manager.findByRepoPath`; on miss it calls `manager.register` with no args; on both paths it performs a conditional claim (grant if no session holds the claim). `claim_reviews` bypasses `resolveProject` and calls `manager.register` directly with the caller-supplied description/baseBranch, then unconditionally claims. `start` is deleted. A small test harness drives the real MCP HTTP surface via supertest so we can assert tool behavior end-to-end.

**Tech Stack:** TypeScript, Node, Express, `@modelcontextprotocol/sdk`, vitest, supertest.

**Spec:** `docs/superpowers/specs/2026-04-23-mcp-auto-init-design.md`

---

## File Structure

**Modified:**
- `server/mcp.ts` — rename `requireProject` → `resolveProject`, remove `start` tool, grow `claim_reviews`, drop "call start first" error, add `_testing_getDiffClaimHolder` export
- `server/session.ts` — `description` becomes a mutable field (drop `readonly`)
- `server/session-manager.ts` — `register` updates existing session's description when explicitly passed
- `skills/lgtm/SKILL.md` — drop `start`, use `claim_reviews` as the entry point
- `skills/analyze/SKILL.md` — drop `start` reference, rely on auto-init

**Created:**
- `server/__tests__/helpers/mcp-client.ts` — test harness that initializes an MCP session over HTTP and exposes a `callTool` helper
- `server/__tests__/mcp.test.ts` — MCP tool behavior tests
- `server/__tests__/session-manager-register.test.ts` — unit test for `register` description-update behavior (may land inside the existing `session-manager.test.ts` if one exists; check first)

---

## Task 1: Add MCP test harness

**Files:**
- Create: `server/__tests__/helpers/mcp-client.ts`
- Create: `server/__tests__/mcp.test.ts`

This task lands the infrastructure that later tasks need. It ships a single smoke test so we can verify the harness works against the existing (unchanged) MCP surface before we touch any behavior.

- [ ] **Step 1: Inspect the existing app factory**

Run: `grep -n "export function createApp\|mountMcp" server/app.ts`

Expected: `createApp` exists and calls `mountMcp(app, manager)` internally (or is composable with it). If `createApp` doesn't already mount MCP, the harness will need to mount it manually. Read `server/app.ts` to confirm. Note the actual wiring for use in the helper.

- [ ] **Step 2: Write the MCP client helper**

Create `server/__tests__/helpers/mcp-client.ts`:

```ts
import request from 'supertest';
import type express from 'express';

export interface McpClient {
  sessionId: string;
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>;
  close: () => Promise<void>;
}

export interface McpToolResult {
  /** Parsed JSON payload from the tool's first text content, if parseable. */
  json?: unknown;
  /** Raw text payload from the tool's first text content. */
  text?: string;
  /** The full JSON-RPC response body. */
  raw: unknown;
  /** JSON-RPC error message, if the call errored. */
  error?: string;
}

/**
 * Parse a response body that may be either JSON or SSE. The streamable HTTP
 * transport can return either depending on the request. For tools that don't
 * stream, we expect a single `message` SSE event or a JSON body.
 */
function parseBody(res: request.Response): unknown {
  if (res.body && Object.keys(res.body).length > 0) return res.body;
  const text = res.text ?? '';
  // SSE frames look like: "event: message\ndata: {...}\n\n"
  const dataLines = text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length));
  if (dataLines.length === 0) return null;
  // Use the last data frame (the tool result)
  try {
    return JSON.parse(dataLines[dataLines.length - 1]);
  } catch {
    return null;
  }
}

export async function createMcpClient(app: express.Express): Promise<McpClient> {
  const init = await request(app)
    .post('/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'lgtm-test', version: '0.0.0' },
      },
    });
  const sessionId = init.headers['mcp-session-id'] as string | undefined;
  if (!sessionId) {
    throw new Error(
      `MCP initialize failed (status ${init.status}): ${init.text || JSON.stringify(init.body)}`,
    );
  }

  await request(app)
    .post('/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('mcp-session-id', sessionId)
    .send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  let nextId = 2;
  const callTool = async (name: string, args: Record<string, unknown>): Promise<McpToolResult> => {
    const res = await request(app)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('mcp-session-id', sessionId)
      .send({
        jsonrpc: '2.0',
        id: nextId++,
        method: 'tools/call',
        params: { name, arguments: args },
      });
    const raw = parseBody(res);
    const rpc = raw as { result?: { content?: Array<{ type: string; text?: string }> }; error?: { message?: string } } | null;
    if (rpc?.error?.message) return { raw, error: rpc.error.message };
    const text = rpc?.result?.content?.[0]?.text;
    if (typeof text !== 'string') return { raw };
    try {
      return { raw, text, json: JSON.parse(text) };
    } catch {
      return { raw, text };
    }
  };

  const close = async () => {
    await request(app)
      .delete('/mcp')
      .set('mcp-session-id', sessionId);
  };

  return { sessionId, callTool, close };
}
```

- [ ] **Step 3: Write a smoke test that initializes against the current MCP surface**

Create `server/__tests__/mcp.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import { initStore, closeStore } from '../store.js';
import { SessionManager } from '../session-manager.js';
import { createApp } from '../app.js';
import { createMcpClient, type McpClient } from './helpers/mcp-client.js';

describe('mcp', () => {
  let fixture: GitFixture;
  let tmpDir: string;
  let app: ReturnType<typeof createApp>;
  let manager: SessionManager;
  let client: McpClient;

  beforeAll(async () => {
    fixture = createGitFixture();
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-mcp-test-'));
    initStore(join(tmpDir, 'test.db'));
    manager = new SessionManager(9999);
    app = createApp(manager);
    client = await createMcpClient(app);
  });

  afterAll(async () => {
    await client.close();
    for (const project of manager.list()) manager.deregister(project.slug);
    closeStore();
    fixture.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('harness can call a tool', async () => {
    // claim_reviews exists today and is safe to call — it registers if needed.
    // Using it here is a smoke test that the harness wiring works. We only
    // assert that the call succeeded (no JSON-RPC error, a payload came back);
    // the response shape is validated explicitly in later tasks.
    const res = await client.callTool('claim_reviews', { repoPath: fixture.repoPath });
    expect(res.error).toBeUndefined();
    expect(res.json).toBeDefined();
  });
});
```

- [ ] **Step 4: Run the smoke test**

Run: `npx vitest run server/__tests__/mcp.test.ts`

Expected: PASS. If the harness can't parse the response, inspect `raw` and adjust `parseBody`. If `mcp-session-id` is absent, confirm `createApp` mounts MCP at `/mcp`.

- [ ] **Step 5: Commit**

```bash
git add server/__tests__/helpers/mcp-client.ts server/__tests__/mcp.test.ts
git commit -m "test: add MCP HTTP test harness"
```

---

## Task 2: Rename requireProject → resolveProject (no behavior change)

**Files:**
- Modify: `server/mcp.ts`

Pure rename. Later tasks change the behavior under the new name.

- [ ] **Step 1: Rename the helper and all call sites**

Edit `server/mcp.ts`. Change the function definition:

```ts
// before:
function requireProject(manager: SessionManager, repoPath: string, mcpServer?: McpServer): { found: ReturnType<SessionManager['findByRepoPath']> & object } | { error: McpTextResult } {
// after:
function resolveProject(manager: SessionManager, repoPath: string, mcpServer?: McpServer): { found: ReturnType<SessionManager['findByRepoPath']> & object } | { error: McpTextResult } {
```

Replace all callers: six call sites in the tools (`add_document`, `comment`, `read_feedback`, `set_analysis`, `claim_reviews`, `reply`, `stop`). Each line like `const lookup = requireProject(manager, repoPath, server);` becomes `const lookup = resolveProject(manager, repoPath, server);`.

- [ ] **Step 2: Build and run all tests**

Run: `npm run build:server && npm test`

Expected: PASS across the board. No behavior has changed.

- [ ] **Step 3: Commit**

```bash
git add server/mcp.ts
git commit -m "refactor(mcp): rename requireProject to resolveProject"
```

---

## Task 3: Make Session description mutable

**Files:**
- Modify: `server/session.ts`

`claim_reviews` will need to update `description` on an already-registered session. Today the field is `readonly`, which blocks that.

- [ ] **Step 1: Drop readonly from description**

In `server/session.ts`, change:

```ts
readonly description: string;
```

to:

```ts
description: string;
```

(The field is still assigned in the constructor the same way.)

- [ ] **Step 2: Build and run tests**

Run: `npm run build:server && npm run test:server`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/session.ts
git commit -m "refactor(session): make description mutable"
```

---

## Task 4: Update register to refresh description on existing sessions

**Files:**
- Modify: `server/session-manager.ts`
- Modify: `server/__tests__/session-manager.test.ts` (add test)

`manager.register` already updates `baseBranch` on an existing session when explicitly passed. Extend the same treatment to `description`.

- [ ] **Step 1: Write the failing test**

Find `server/__tests__/session-manager.test.ts`. Add this test inside the existing `describe('SessionManager', ...)` block (or equivalent):

```ts
it('register updates description on an existing session when passed', () => {
  const first = manager.register(fixture.repoPath, { description: 'first' });
  const session = manager.get(first.slug)!;
  expect(session.description).toBe('first');

  manager.register(fixture.repoPath, { description: 'second' });
  expect(session.description).toBe('second');
});

it('register preserves description when not passed', () => {
  manager.register(fixture.repoPath, { description: 'initial' });
  const session = manager.get(manager.findByRepoPath(fixture.repoPath)!.slug)!;
  manager.register(fixture.repoPath); // no opts
  expect(session.description).toBe('initial');
});
```

If `session-manager.test.ts` doesn't exist, create it using the same `createGitFixture` + `initStore` + `SessionManager` setup as `routes.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/session-manager.test.ts`

Expected: FAIL — the first test fails because `description` is never updated on the existing branch.

- [ ] **Step 3: Update register**

In `server/session-manager.ts`, find the early-return branch inside `register`:

```ts
for (const [slug, session] of this._sessions) {
  if (session.repoPath === absPath) {
    // Update base branch if explicitly provided
    if (opts?.baseBranch && opts.baseBranch !== session.baseBranch) {
      session.baseBranch = opts.baseBranch;
      session.persist();
    }
    return { slug, url: `http://127.0.0.1:${this._port}/project/${slug}/` };
  }
}
```

Replace with:

```ts
for (const [slug, session] of this._sessions) {
  if (session.repoPath === absPath) {
    let changed = false;
    if (opts?.baseBranch && opts.baseBranch !== session.baseBranch) {
      session.baseBranch = opts.baseBranch;
      changed = true;
    }
    if (opts?.description !== undefined && opts.description !== session.description) {
      session.description = opts.description;
      changed = true;
    }
    if (changed) session.persist();
    return { slug, url: `http://127.0.0.1:${this._port}/project/${slug}/` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/session-manager.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/session-manager.ts server/__tests__/session-manager.test.ts
git commit -m "feat(session-manager): update description on re-register"
```

---

## Task 5: Auto-register in resolveProject

**Files:**
- Modify: `server/mcp.ts`
- Modify: `server/__tests__/mcp.test.ts`

Change `resolveProject` to auto-register on miss. The error branch goes away for every caller except `stop`.

- [ ] **Step 1: Write the failing test**

Add to `server/__tests__/mcp.test.ts`:

```ts
describe('auto-init', () => {
  let autoInitFixture: GitFixture;

  beforeAll(() => {
    autoInitFixture = createGitFixture();
  });

  afterAll(() => {
    autoInitFixture.cleanup();
  });

  it('comment on an unregistered repo auto-registers the project', async () => {
    const local = await createMcpClient(app);
    try {
      expect(manager.findByRepoPath(autoInitFixture.repoPath)).toBeUndefined();

      const res = await local.callTool('comment', {
        repoPath: autoInitFixture.repoPath,
        comments: [{ file: 'src/app.ts', line: 1, comment: 'hi' }],
      });

      expect(res.json).toMatchObject({ ok: true });
      expect(manager.findByRepoPath(autoInitFixture.repoPath)).toBeDefined();
    } finally {
      await local.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/mcp.test.ts -t "auto-init"`

Expected: FAIL — `comment` returns `{ error: 'Project not registered. Call start first.' }`.

- [ ] **Step 3: Update resolveProject**

In `server/mcp.ts`, replace the `resolveProject` function with:

```ts
function resolveProject(
  manager: SessionManager,
  repoPath: string,
  mcpServer?: McpServer,
): { found: { slug: string; session: import('./session.js').Session } } {
  let found = manager.findByRepoPath(repoPath);
  if (!found) {
    const { slug } = manager.register(repoPath);
    const session = manager.get(slug)!;
    found = { slug, session };
  }
  if (mcpServer) associateMcpSession(mcpServer, found.slug);
  return { found };
}
```

(The return shape changes — callers no longer need to check `'error' in lookup`.)

- [ ] **Step 4: Update every resolveProject caller**

For each call site in `add_document`, `comment`, `read_feedback`, `set_analysis`, `claim_reviews`, `reply`, replace:

```ts
const lookup = resolveProject(manager, repoPath, server);
if ('error' in lookup) return lookup.error;
const { found } = lookup;
```

with:

```ts
const { found } = resolveProject(manager, repoPath, server);
```

For `stop`, DO NOT use `resolveProject`. Replace its body:

```ts
async ({ repoPath }) => {
  const found = manager.findByRepoPath(repoPath);
  if (!found) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active review session for this repo path.' }) }] };
  }
  manager.deregister(found.slug);
  return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, slug: found.slug }) }] };
},
```

- [ ] **Step 5: Run auto-init test to verify it passes**

Run: `npx vitest run server/__tests__/mcp.test.ts -t "auto-init"`

Expected: PASS.

- [ ] **Step 6: Run full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/mcp.ts server/__tests__/mcp.test.ts
git commit -m "feat(mcp): auto-register project on any tool call"
```

---

## Task 6: Export diff-claim probe for testing

**Files:**
- Modify: `server/mcp.ts`

Tests need to verify which MCP session (if any) holds the diff-review claim. Expose a minimal probe.

- [ ] **Step 1: Add the exported helper**

At the bottom of `server/mcp.ts` (after `notifyChannel`), add:

```ts
/**
 * Test-only probe: returns the mcp-session-id that currently holds the diff-
 * review claim for the given slug, or null if no session holds it.
 */
export function _testing_getDiffClaimHolder(slug: string): string | null {
  for (const [sid, entry] of activeMcpSessions) {
    if (entry.projectSlug === slug && entry.claimedDiff) return sid;
  }
  return null;
}
```

- [ ] **Step 2: Build**

Run: `npm run build:server`

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add server/mcp.ts
git commit -m "test(mcp): export diff-claim probe for tests"
```

---

## Task 7: Auto-claim-if-unclaimed in resolveProject

**Files:**
- Modify: `server/mcp.ts`
- Modify: `server/__tests__/mcp.test.ts`

`resolveProject` grants the diff claim to the calling session only when no session currently holds it.

- [ ] **Step 1: Write the failing tests**

Add to `server/__tests__/mcp.test.ts` inside the `auto-init` describe (or a new `describe('auto-claim', ...)` block):

```ts
describe('auto-claim', () => {
  let claimFixture: GitFixture;

  beforeAll(() => {
    claimFixture = createGitFixture();
  });

  afterAll(() => {
    claimFixture.cleanup();
  });

  it('first comment auto-claims diff reviews for the calling session', async () => {
    const clientA = await createMcpClient(app);
    try {
      await clientA.callTool('comment', {
        repoPath: claimFixture.repoPath,
        comments: [{ file: 'src/app.ts', line: 1, comment: 'x' }],
      });
      const slug = manager.findByRepoPath(claimFixture.repoPath)!.slug;
      expect(_testing_getDiffClaimHolder(slug)).toBe(clientA.sessionId);
    } finally {
      await clientA.close();
    }
  });

  it('second session does not steal the claim', async () => {
    const clientA = await createMcpClient(app);
    const clientB = await createMcpClient(app);
    try {
      await clientA.callTool('comment', {
        repoPath: claimFixture.repoPath,
        comments: [{ file: 'src/app.ts', line: 1, comment: 'a' }],
      });
      const slug = manager.findByRepoPath(claimFixture.repoPath)!.slug;
      const firstHolder = _testing_getDiffClaimHolder(slug);

      await clientB.callTool('comment', {
        repoPath: claimFixture.repoPath,
        comments: [{ file: 'src/app.ts', line: 2, comment: 'b' }],
      });

      expect(_testing_getDiffClaimHolder(slug)).toBe(firstHolder);
      expect(firstHolder).toBe(clientA.sessionId);
    } finally {
      await clientA.close();
      await clientB.close();
    }
  });
});
```

Add the probe import at the top of the file:

```ts
import { _testing_getDiffClaimHolder } from '../mcp.js';
```

Note: `auto-claim` should use its **own** fixture repo — separate from `auto-init`'s — because the previous test auto-registered and claimed there, poisoning the starting state. The fixture created in this describe block is the right scope.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/mcp.test.ts -t "auto-claim"`

Expected: FAIL — today `resolveProject` does not claim. `_testing_getDiffClaimHolder` returns `null`.

- [ ] **Step 3: Add auto-claim to resolveProject**

In `server/mcp.ts`, replace the body of `resolveProject` with:

```ts
function resolveProject(
  manager: SessionManager,
  repoPath: string,
  mcpServer?: McpServer,
): { found: { slug: string; session: import('./session.js').Session } } {
  let found = manager.findByRepoPath(repoPath);
  if (!found) {
    const { slug } = manager.register(repoPath);
    const session = manager.get(slug)!;
    found = { slug, session };
  }
  if (mcpServer) {
    associateMcpSession(mcpServer, found.slug);
    maybeAutoClaim(mcpServer, found.slug);
  }
  return { found };
}

function maybeAutoClaim(server: McpServer, slug: string): void {
  for (const entry of activeMcpSessions.values()) {
    if (entry.projectSlug === slug && entry.claimedDiff) return; // someone holds it
  }
  for (const entry of activeMcpSessions.values()) {
    if (entry.server === server) {
      entry.claimedDiff = true;
      return;
    }
  }
}
```

- [ ] **Step 4: Run auto-claim tests to verify they pass**

Run: `npx vitest run server/__tests__/mcp.test.ts -t "auto-claim"`

Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/mcp.ts server/__tests__/mcp.test.ts
git commit -m "feat(mcp): auto-claim diff reviews when no session holds the claim"
```

---

## Task 8: Grow claim_reviews (description, baseBranch, URL return)

**Files:**
- Modify: `server/mcp.ts`
- Modify: `server/__tests__/mcp.test.ts`

`claim_reviews` absorbs `start`'s remaining responsibilities. New shape: accepts optional `description` and `baseBranch`, unconditionally claims, returns `{ slug, url }`.

- [ ] **Step 1: Write the failing tests**

Add to `server/__tests__/mcp.test.ts` (new describe block):

```ts
describe('claim_reviews', () => {
  let crFixture: GitFixture;

  beforeAll(() => {
    crFixture = createGitFixture();
  });

  afterAll(() => {
    crFixture.cleanup();
  });

  it('returns slug and url', async () => {
    const c = await createMcpClient(app);
    try {
      const res = await c.callTool('claim_reviews', { repoPath: crFixture.repoPath });
      expect(res.json).toMatchObject({ slug: expect.any(String), url: expect.stringContaining('/project/') });
    } finally {
      await c.close();
    }
  });

  it('takes the claim unconditionally when another session holds it', async () => {
    const clientA = await createMcpClient(app);
    const clientB = await createMcpClient(app);
    try {
      await clientA.callTool('comment', {
        repoPath: crFixture.repoPath,
        comments: [{ file: 'src/app.ts', line: 1, comment: 'a' }],
      });
      const slug = manager.findByRepoPath(crFixture.repoPath)!.slug;
      expect(_testing_getDiffClaimHolder(slug)).toBe(clientA.sessionId);

      await clientB.callTool('claim_reviews', { repoPath: crFixture.repoPath });
      expect(_testing_getDiffClaimHolder(slug)).toBe(clientB.sessionId);
    } finally {
      await clientA.close();
      await clientB.close();
    }
  });

  it('sets description on a fresh repo', async () => {
    const c = await createMcpClient(app);
    const freshFixture = createGitFixture();
    try {
      await c.callTool('claim_reviews', {
        repoPath: freshFixture.repoPath,
        description: 'review banner',
      });
      const found = manager.findByRepoPath(freshFixture.repoPath)!;
      expect(found.session.description).toBe('review banner');
    } finally {
      await c.close();
      freshFixture.cleanup();
    }
  });

  it('updates description on an already-registered repo', async () => {
    const c = await createMcpClient(app);
    const freshFixture = createGitFixture();
    try {
      manager.register(freshFixture.repoPath, { description: 'original' });
      await c.callTool('claim_reviews', {
        repoPath: freshFixture.repoPath,
        description: 'updated',
      });
      const found = manager.findByRepoPath(freshFixture.repoPath)!;
      expect(found.session.description).toBe('updated');
    } finally {
      await c.close();
      freshFixture.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/mcp.test.ts -t "claim_reviews"`

Expected: FAIL — the current `claim_reviews` accepts no `description`/`baseBranch` and returns `{ ok: true, slug }` rather than `{ slug, url }`.

- [ ] **Step 3: Update claim_reviews in server/mcp.ts**

Replace the existing `claim_reviews` tool registration with:

```ts
server.tool(
  'claim_reviews',
  'Claim code review notifications for a project. Auto-registers the project if needed. When the reviewer submits feedback on the diff, only the Claude session that called claim_reviews most recently will receive the notification. Optionally sets a description banner and base branch override. Returns the review URL.',
  {
    repoPath: z.string().describe('Absolute path to the git repository'),
    description: z.string().optional().describe('Review context shown as a banner in the UI'),
    baseBranch: z.string().optional().describe('Base branch (auto-detected if omitted)'),
  },
  async ({ repoPath, description, baseBranch }) => {
    const result = manager.register(repoPath, { description, baseBranch });
    associateMcpSession(server, result.slug);
    claimDiffReviews(server, result.slug);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  },
);
```

Note: this bypasses `resolveProject` — the description/baseBranch values flow through `manager.register` directly, and the claim is unconditional.

- [ ] **Step 4: Run claim_reviews tests to verify they pass**

Run: `npx vitest run server/__tests__/mcp.test.ts -t "claim_reviews"`

Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/mcp.ts server/__tests__/mcp.test.ts
git commit -m "feat(mcp): claim_reviews accepts description/baseBranch and returns URL"
```

---

## Task 9: Remove the start tool

**Files:**
- Modify: `server/mcp.ts`
- Modify: `server/__tests__/mcp.test.ts`

With `claim_reviews` covering description/baseBranch/URL-return and auto-init covering the rest, `start` has no remaining job.

- [ ] **Step 1: Write a failing test that the tool is gone**

Add to `server/__tests__/mcp.test.ts`:

```ts
it('start tool no longer exists', async () => {
  const c = await createMcpClient(app);
  try {
    const res = await c.callTool('start', { repoPath: fixture.repoPath });
    // MCP SDK returns a JSON-RPC error for unknown tools; some SDK versions
    // return a result with an error field. Accept either.
    const hasError = Boolean(res.error) || (res.json && typeof res.json === 'object' && 'error' in (res.json as object));
    expect(hasError).toBe(true);
  } finally {
    await c.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/mcp.test.ts -t "start tool no longer exists"`

Expected: FAIL — `start` still exists and returns success.

- [ ] **Step 3: Delete the start tool registration**

In `server/mcp.ts`, delete the entire `server.tool('start', ..., async ({ repoPath, description, baseBranch }) => { ... })` block. Its logic is now in `claim_reviews`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/mcp.test.ts -t "start tool no longer exists"`

Expected: PASS.

- [ ] **Step 5: Add a test for stop on an unregistered repo**

Add to `server/__tests__/mcp.test.ts`:

```ts
describe('stop', () => {
  it('returns an error when the repo is not registered', async () => {
    const c = await createMcpClient(app);
    const freshFixture = createGitFixture();
    try {
      const res = await c.callTool('stop', { repoPath: freshFixture.repoPath });
      expect(res.json).toMatchObject({ error: 'No active review session for this repo path.' });
    } finally {
      await c.close();
      freshFixture.cleanup();
    }
  });
});
```

- [ ] **Step 6: Run the stop test**

Run: `npx vitest run server/__tests__/mcp.test.ts -t "stop"`

Expected: PASS (the new error message is already in place from Task 5).

- [ ] **Step 7: Run full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/mcp.ts server/__tests__/mcp.test.ts
git commit -m "feat(mcp): remove start tool, claim_reviews is the new entry point"
```

---

## Task 10: Clean tool descriptions

**Files:**
- Modify: `server/mcp.ts`

Tool descriptions still reference "Must be called before any other LGTM tools" / "Requires an active session" — stale post-auto-init. Update them.

- [ ] **Step 1: Update add_document description**

Find:

```ts
'Add a document (spec, design doc, markdown file) as a reviewable tab alongside the diff. The user can comment on it in the review UI. Requires an active session.',
```

Replace with:

```ts
'Add a document (spec, design doc, markdown file) as a reviewable tab alongside the diff. The user can comment on it in the review UI. Auto-registers the project if needed.',
```

- [ ] **Step 2: Scan for other stale descriptions**

Run: `grep -n "start first\|active session\|Must be called" server/mcp.ts`

Expected: no results (or if any remain, edit them similarly — reword "Requires an active session" → "Auto-registers if needed"; drop any "Must be called after start").

- [ ] **Step 3: Build and test**

Run: `npm run build:server && npm run test:server`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/mcp.ts
git commit -m "docs(mcp): refresh tool descriptions for auto-init"
```

---

## Task 11: Update skills to drop start

**Files:**
- Modify: `skills/lgtm/SKILL.md`
- Modify: `skills/analyze/SKILL.md`

The skills mention `start` in their `allowed-tools` frontmatter and in their body. Swap `start` for `claim_reviews` and reword flow prose.

- [ ] **Step 1: Update skills/lgtm/SKILL.md allowed-tools**

Replace the frontmatter `allowed-tools` line. Find:

```
allowed-tools: "mcp__lgtm__start,mcp__lgtm__add_document,mcp__lgtm__comment,mcp__lgtm__read_feedback,mcp__lgtm__stop,mcp__plugin_lgtm_lgtm__start,mcp__plugin_lgtm_lgtm__add_document,mcp__plugin_lgtm_lgtm__comment,mcp__plugin_lgtm_lgtm__read_feedback,mcp__plugin_lgtm_lgtm__stop,Skill(lgtm:analyze)"
```

Replace with:

```
allowed-tools: "mcp__lgtm__claim_reviews,mcp__lgtm__add_document,mcp__lgtm__comment,mcp__lgtm__read_feedback,mcp__lgtm__stop,mcp__plugin_lgtm_lgtm__claim_reviews,mcp__plugin_lgtm_lgtm__add_document,mcp__plugin_lgtm_lgtm__comment,mcp__plugin_lgtm_lgtm__read_feedback,mcp__plugin_lgtm_lgtm__stop,Skill(lgtm:analyze)"
```

- [ ] **Step 2: Rewrite the Workflow section**

Replace the entire `### 1. Register the project` block with:

```markdown
### 1. Claim the review session

Call the `claim_reviews` MCP tool with the repo path. This registers the project
(if not already registered), claims diff-review notifications for this Claude
session, and returns the browser URL. You can optionally pass a `description`
(shown as a banner) or `baseBranch` override.

`claim_reviews` is idempotent and safe to call repeatedly. Other tools
(`comment`, `add_document`, `read_feedback`) auto-register on their own — you
only need `claim_reviews` if you want to be notified when the user submits
feedback, or to set/update the description banner.
```

- [ ] **Step 3: Update the tools table**

Find the `| Tool | Purpose |` table. Replace the `start` row with:

```
| `claim_reviews` | Claim review notifications, set description, get URL — the typical entry point |
```

- [ ] **Step 4: Update the /lgtm command section**

Find:

```markdown
Users can type `/lgtm` to quickly register the current project. This is equivalent to
calling `start` with the repo path.
```

Replace with:

```markdown
Users can type `/lgtm` to quickly register the current project. This is equivalent to
calling `claim_reviews` with the repo path.
```

- [ ] **Step 5: Update skills/analyze/SKILL.md**

Replace the frontmatter `allowed-tools`. Find:

```
allowed-tools: "mcp__lgtm__set_analysis,mcp__lgtm__start,mcp__plugin_lgtm_lgtm__set_analysis,mcp__plugin_lgtm_lgtm__start,Agent,Bash(git:*)"
```

Replace with:

```
allowed-tools: "mcp__lgtm__set_analysis,mcp__plugin_lgtm_lgtm__set_analysis,Agent,Bash(git:*)"
```

Find the `## Prerequisites` section:

```markdown
## Prerequisites

An LGTM review session must be active for the repo. If no session exists,
start one with `start` (calling it again for an existing session is safe —
it returns the existing URL).
```

Replace with:

```markdown
## Prerequisites

None. `set_analysis` auto-registers the project if it isn't already. If you
want the review UI open and claimed for notifications, call `claim_reviews`
separately (via the `lgtm` skill).
```

- [ ] **Step 6: Verify no stray start references remain**

Run: `grep -rn "mcp__lgtm__start\|mcp__plugin_lgtm_lgtm__start\|'start'\|\"start\"" skills/ .claude-plugin/`

Expected: no results (or only unrelated matches — review each hit and confirm).

- [ ] **Step 7: Run full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add skills/lgtm/SKILL.md skills/analyze/SKILL.md
git commit -m "docs(skills): drop start tool, document auto-init"
```

---

## Task 12: Final verification

**Files:** none

- [ ] **Step 1: Full test suite**

Run: `npm test`

Expected: PASS. Note the test count — should be the prior count plus the new MCP tests.

- [ ] **Step 2: Lint and format**

Run: `npm run lint && npm run format:check`

Expected: PASS. If format fails, `npm run format` and commit the formatting changes.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Manual smoke (optional, but recommended)**

Start the server (`npm run dev:all`), then from a separate Claude session (or any MCP client) call `comment` directly without calling any init tool first. Verify the review URL appears in the browser with the diff showing.

---

## Self-Review Notes

- **Spec coverage:** Every numbered test in the spec's "Tests" section maps to a Task 5/7/8/9 test. ✓
- **Types:** `resolveProject` return type changes in Task 5 — all callers are updated in the same task. ✓
- **Placeholder scan:** No TBDs, TODOs, or "similar to Task N" references. ✓
- **Out-of-scope:** No UI changes, no REST API changes, no notification-channel changes. ✓
