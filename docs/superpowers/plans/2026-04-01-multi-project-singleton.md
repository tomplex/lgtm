# Multi-Project Singleton Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the server from single-session CLI to a long-running singleton managing multiple review projects via path-based routing.

**Architecture:** New SessionManager module manages a Map of Sessions. Express routes move under `/project/:slug/` with middleware resolving the session. Frontend prefixes all API calls with the project slug extracted from the URL. Top-level `/projects` endpoints for registration.

**Tech Stack:** TypeScript, Express, existing Session class unchanged.

**Spec:** `docs/superpowers/specs/2026-04-01-multi-project-singleton-design.md`

---

### Task 1: Create SessionManager

**Files:**
- Create: `server/session-manager.ts`

- [ ] **Step 1: Create server/session-manager.ts**

```typescript
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { detectBaseBranch } from './git-ops.js';
import { Session } from './session.js';

const REVIEW_DIR = '/tmp/claude-review';

export interface ProjectInfo {
  slug: string;
  repoPath: string;
  description: string;
}

export class SessionManager {
  private _sessions = new Map<string, Session>();
  private _port: number;

  constructor(port: number) {
    this._port = port;
    mkdirSync(REVIEW_DIR, { recursive: true });
  }

  register(
    repoPath: string,
    opts?: { description?: string; baseBranch?: string },
  ): { slug: string; url: string } {
    const absPath = resolve(repoPath);

    // Check if this path is already registered
    for (const [slug, session] of this._sessions) {
      if (session.repoPath === absPath) {
        return { slug, url: `http://127.0.0.1:${this._port}/project/${slug}/` };
      }
    }

    const slug = this._deriveSlug(absPath);
    const baseBranch = opts?.baseBranch || detectBaseBranch(absPath);
    const outputPath = `${REVIEW_DIR}/${slug}.md`;
    writeFileSync(outputPath, '');

    const session = new Session({
      repoPath: absPath,
      baseBranch,
      description: opts?.description ?? '',
      outputPath,
    });

    this._sessions.set(slug, session);
    return { slug, url: `http://127.0.0.1:${this._port}/project/${slug}/` };
  }

  get(slug: string): Session | undefined {
    return this._sessions.get(slug);
  }

  list(): ProjectInfo[] {
    const projects: ProjectInfo[] = [];
    for (const [slug, session] of this._sessions) {
      projects.push({
        slug,
        repoPath: session.repoPath,
        description: session.description,
      });
    }
    return projects;
  }

  deregister(slug: string): boolean {
    return this._sessions.delete(slug);
  }

  private _deriveSlug(absPath: string): string {
    let base = basename(absPath).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!base) base = 'project';
    let slug = base;
    let counter = 2;
    while (this._sessions.has(slug)) {
      slug = `${base}-${counter++}`;
    }
    return slug;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/session-manager.ts
git commit -m "add SessionManager for multi-project support"
```

---

### Task 2: Refactor app.ts to use SessionManager with project-scoped routing

**Files:**
- Modify: `server/app.ts`

- [ ] **Step 1: Rewrite server/app.ts**

Replace the entire contents of `server/app.ts` with:

```typescript
import express, { type Request, type Response, type NextFunction, Router } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFileLines, getBranchCommits } from './git-ops.js';
import { type Session, type SSEClient } from './session.js';
import { type SessionManager } from './session-manager.js';

// Extend Express to carry the resolved session
declare global {
  namespace Express {
    interface Locals {
      session: Session;
    }
  }
}

export function createApp(manager: SessionManager): express.Express {
  const app = express();
  app.use(express.json());

  // --- Top-level project management routes ---

  app.post('/projects', (req, res) => {
    const { repoPath, description, baseBranch } = req.body;
    if (!repoPath) {
      res.status(400).json({ error: 'repoPath is required' });
      return;
    }
    const result = manager.register(repoPath, { description, baseBranch });
    console.log(`PROJECT_REGISTERED=${result.slug} path=${repoPath}`);
    res.json({ ok: true, ...result });
  });

  app.get('/projects', (_req, res) => {
    res.json({ projects: manager.list() });
  });

  app.delete('/projects/:slug', (req, res) => {
    const removed = manager.deregister(req.params.slug);
    if (!removed) {
      res.status(404).json({ error: `Project not found: ${req.params.slug}` });
      return;
    }
    res.json({ ok: true });
  });

  // --- Project-scoped router ---

  const projectRouter = Router({ mergeParams: true });

  // Middleware: resolve slug to session
  projectRouter.use((req: Request, res: Response, next: NextFunction) => {
    const session = manager.get(req.params.slug);
    if (!session) {
      res.status(404).json({ error: `Project not found: ${req.params.slug}` });
      return;
    }
    res.locals.session = session;
    next();
  });

  // --- GET routes ---

  projectRouter.get('/items', (_req, res) => {
    res.json({ items: res.locals.session.items });
  });

  projectRouter.get('/data', (req, res) => {
    const itemId = (req.query.item as string) ?? 'diff';
    const commits = req.query.commits as string | undefined;
    const data = res.locals.session.getItemData(itemId, commits);
    res.json(data);
  });

  projectRouter.get('/context', (req, res) => {
    const session = res.locals.session;
    const file = (req.query.file as string) ?? '';
    const line = parseInt(req.query.line as string) || 0;
    const count = parseInt(req.query.count as string) || 20;
    const direction = (req.query.direction as string) ?? 'down';
    const lines = getFileLines(session.repoPath, file, line, count, direction);
    res.json({ lines });
  });

  projectRouter.get('/file', (req, res) => {
    const session = res.locals.session;
    const filePath = (req.query.path as string) ?? '';
    const fullPath = join(session.repoPath, filePath);
    if (!existsSync(fullPath)) {
      res.json({ lines: [] });
      return;
    }
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n').map((line, i) => ({
      num: i + 1,
      content: line,
    }));
    res.json({ lines });
  });

  projectRouter.get('/commits', (_req, res) => {
    const session = res.locals.session;
    const commits = getBranchCommits(session.repoPath, session.baseBranch);
    res.json({ commits });
  });

  projectRouter.get('/events', (req, res) => {
    const session = res.locals.session;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const client: SSEClient = {
      send(event: string, data: unknown) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
    };

    session.subscribe(client);

    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30_000);

    req.on('close', () => {
      clearInterval(keepalive);
      session.unsubscribe(client);
    });
  });

  projectRouter.get('/analysis', (_req, res) => {
    res.json({ analysis: res.locals.session.analysis });
  });

  // --- POST routes ---

  projectRouter.post('/items', (req, res) => {
    const session = res.locals.session;
    const { path: filepath = '', title = '', id = '' } = req.body;
    const itemTitle = title || filepath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled';
    const itemId = id || slugify(itemTitle);
    const result = session.addItem(itemId, itemTitle, filepath);
    console.log(`ITEM_ADDED=${itemId}`);
    session.broadcast('items_changed', { id: itemId });
    res.json(result);
  });

  projectRouter.post('/comments', (req, res) => {
    const session = res.locals.session;
    const itemId = req.body.item ?? 'diff';
    const newComments = req.body.comments ?? [];
    const count = session.addComments(itemId, newComments);
    console.log(`CLAUDE_COMMENTS_ADDED=${newComments.length} item=${itemId}`);
    session.broadcast('comments_changed', { item: itemId, count: newComments.length });
    res.json({ ok: true, count });
  });

  projectRouter.post('/submit', (req, res) => {
    const session = res.locals.session;
    const commentsText = req.body.comments ?? '';
    const currentRound = session.submitReview(commentsText);
    console.log(`REVIEW_ROUND=${currentRound}`);
    res.json({ ok: true, round: currentRound });
  });

  projectRouter.post('/analysis', (req, res) => {
    const session = res.locals.session;
    session.setAnalysis(req.body);
    console.log(`ANALYSIS_SET files=${Object.keys(req.body.files ?? {}).length}`);
    res.json({ ok: true });
  });

  // --- DELETE routes ---

  projectRouter.delete('/comments', (req, res) => {
    const session = res.locals.session;
    const itemId = req.query.item as string | undefined;
    const index = req.query.index as string | undefined;
    if (itemId && index) {
      session.deleteComment(itemId, parseInt(index));
    } else if (itemId) {
      session.clearComments(itemId);
    } else {
      session.clearComments();
    }
    res.json({ ok: true });
  });

  // Mount project router
  app.use('/project/:slug', projectRouter);

  // --- Static files ---

  const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'dist');
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    // SPA fallback for project URLs
    app.get('/project/{*path}', (_req, res) => {
      res.sendFile(join(distDir, 'index.html'));
    });
  }

  return app;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[ /]/g, '-').slice(0, 40);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: No errors. There may be warnings about the Express.Locals augmentation — if TypeScript errors on the `declare global`, move it to a `server/types.d.ts` file instead.

- [ ] **Step 3: Commit**

```bash
git add server/app.ts
git commit -m "refactor app.ts to project-scoped routing with SessionManager"
```

---

### Task 3: Update server.ts entry point

**Files:**
- Modify: `server/server.ts`

- [ ] **Step 1: Rewrite server/server.ts**

Replace the entire contents of `server/server.ts` with:

```typescript
#!/usr/bin/env node

import { resolve } from 'node:path';
import open from 'open';
import { SessionManager } from './session-manager.js';
import { createApp } from './app.js';

const DEFAULT_PORT = 9900;

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2);
      args[key] = argv[++i];
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv);
  const port = args.port ? parseInt(args.port) : DEFAULT_PORT;

  const manager = new SessionManager(port);
  const app = createApp(manager);

  app.listen(port, '127.0.0.1', () => {
    console.log(`LGTM_URL=http://127.0.0.1:${port}`);
    console.log(`LGTM_PID=${process.pid}`);

    // Convenience: --repo auto-registers a project and opens the browser
    if (args.repo) {
      const repoPath = resolve(args.repo);
      const result = manager.register(repoPath, {
        description: args.description || '',
        baseBranch: args.base || undefined,
      });
      console.log(`PROJECT_REGISTERED=${result.slug}`);
      console.log(`REVIEW_URL=${result.url}`);
      open(result.url);
    }
  });
}

main();
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/server.ts
git commit -m "simplify server.ts to use SessionManager, add --repo convenience flag"
```

---

### Task 4: Update frontend api.ts to prefix project slug

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add baseUrl function and update all fetch calls**

Replace the entire contents of `frontend/src/api.ts` with:

```typescript
import type { SessionItem, Commit, RepoMeta, ClaudeComment, Analysis } from './state';

export interface DiffData {
  mode: 'diff';
  diff: string;
  description: string;
  meta: RepoMeta;
  claudeComments: ClaudeComment[];
}

export interface FileData {
  mode: 'file';
  content: string;
  filename: string;
  filepath: string;
  markdown: boolean;
  title: string;
  claudeComments: ClaudeComment[];
}

export interface ErrorData {
  mode: 'error';
  error: string;
}

export type ItemData = DiffData | FileData | ErrorData;

function getProjectSlug(): string {
  const match = window.location.pathname.match(/^\/project\/([^/]+)/);
  return match?.[1] ?? '';
}

function baseUrl(): string {
  const slug = getProjectSlug();
  return slug ? `/project/${slug}` : '';
}

export async function fetchItems(): Promise<SessionItem[]> {
  const resp = await fetch(`${baseUrl()}/items`);
  const data = await resp.json();
  return data.items || [];
}

export async function fetchItemData(itemId: string, commits?: string): Promise<ItemData> {
  let url = `${baseUrl()}/data?item=${encodeURIComponent(itemId)}`;
  if (commits) url += `&commits=${commits}`;
  const resp = await fetch(url);
  return resp.json();
}

export async function fetchCommits(): Promise<Commit[]> {
  const resp = await fetch(`${baseUrl()}/commits`);
  const data = await resp.json();
  return data.commits || [];
}

export async function fetchContext(
  filepath: string,
  line: number,
  count: number,
  direction: string,
): Promise<{ num: number; content: string }[]> {
  const resp = await fetch(
    `${baseUrl()}/context?file=${encodeURIComponent(filepath)}&line=${line}&count=${count}&direction=${direction}`,
  );
  const data = await resp.json();
  return data.lines || [];
}

export async function fetchFile(filepath: string): Promise<{ num: number; content: string }[]> {
  const resp = await fetch(`${baseUrl()}/file?path=${encodeURIComponent(filepath)}`);
  const data = await resp.json();
  return data.lines || [];
}

export async function submitReview(
  comments: string,
  raw: Record<string, string>,
): Promise<{ ok: boolean; round: number }> {
  const resp = await fetch(`${baseUrl()}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comments, raw }),
  });
  return resp.json();
}

export async function deleteClaudeComment(itemId: string, index: number): Promise<void> {
  await fetch(`${baseUrl()}/comments?item=${encodeURIComponent(itemId)}&index=${index}`, {
    method: 'DELETE',
  });
}

export async function deleteAllClaudeComments(itemId?: string): Promise<void> {
  const url = itemId
    ? `${baseUrl()}/comments?item=${encodeURIComponent(itemId)}`
    : `${baseUrl()}/comments`;
  await fetch(url, { method: 'DELETE' });
}

export async function fetchAnalysis(): Promise<Analysis | null> {
  const resp = await fetch(`${baseUrl()}/analysis`);
  const data = await resp.json();
  return data.analysis || null;
}
```

- [ ] **Step 2: Update SSE connection in main.ts**

In `frontend/src/main.ts`, find the `connectSSE` function (around line 61):

```typescript
function connectSSE(): void {
  const es = new EventSource('/events');
```

Change it to:

```typescript
function connectSSE(): void {
  const slug = window.location.pathname.match(/^\/project\/([^/]+)/)?.[1] ?? '';
  const eventsUrl = slug ? `/project/${slug}/events` : '/events';
  const es = new EventSource(eventsUrl);
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.ts frontend/src/main.ts
git commit -m "prefix all frontend API calls with project slug from URL"
```

---

### Task 5: Update Vite dev proxy

**Files:**
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Replace vite.config.ts**

Replace the entire contents of `frontend/vite.config.ts` with:

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/project': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9900}`,
      },
      '/projects': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9900}`,
      },
    },
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add frontend/vite.config.ts
git commit -m "update Vite proxy for project-scoped routes"
```

---

### Task 6: Build, verify, and test

**Files:**
- No new files

- [ ] **Step 1: Build the frontend**

Run: `cd frontend && npm run build`
Expected: Build succeeds.

- [ ] **Step 2: Start the server with --repo convenience flag**

Run: `npx tsx server/server.ts --repo /Users/tom/dev/claude-review --port 9900`
Expected:
- Prints `LGTM_URL=http://127.0.0.1:9900`
- Prints `LGTM_PID=<pid>`
- Prints `PROJECT_REGISTERED=claude-review`
- Prints `REVIEW_URL=http://127.0.0.1:9900/project/claude-review/`
- Opens browser to the project URL
- Review UI loads and shows the diff

- [ ] **Step 3: Test project management API**

```bash
# List projects
curl -s http://127.0.0.1:9900/projects | python3 -m json.tool

# Register another project (use any repo path you have)
curl -s -X POST http://127.0.0.1:9900/projects \
  -H 'Content-Type: application/json' \
  -d '{"repoPath": "/Users/tom/dev/claude-review"}' | python3 -m json.tool
# Should return existing slug (idempotent)

# Test project-scoped API
curl -s http://127.0.0.1:9900/project/claude-review/items | python3 -m json.tool
curl -s "http://127.0.0.1:9900/project/claude-review/data?item=diff" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['mode'])"

# Test 404 for unknown project
curl -s http://127.0.0.1:9900/project/nonexistent/items
# Should return 404 with error message
```

- [ ] **Step 4: Test frontend interactions**

Open browser to `http://127.0.0.1:9900/project/claude-review/`. Verify:
1. Diff view loads with files
2. Comments work (add, edit, delete)
3. Submit review works
4. SSE events work (POST a comment via curl and see toast notification)

Kill the server when done.

- [ ] **Step 5: Commit build output**

```bash
git add frontend/dist/
git commit -m "rebuild frontend with project-scoped API calls"
```
