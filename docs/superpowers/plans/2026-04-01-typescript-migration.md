# TypeScript Server Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Python backend (server.py + git_ops.py) to TypeScript/Express, preserving the identical HTTP API and behavior.

**Architecture:** Three TypeScript modules — `git-ops.ts` (git commands), `session.ts` (Session class + types), `app.ts` (Express routes) — plus a CLI entry point `server.ts`. Express serves the same API the frontend already talks to. Hand-rolled SSE. Static file serving for `frontend/dist/`.

**Tech Stack:** TypeScript, Express, Node.js `child_process`, `open` (browser launcher)

**Spec:** `docs/superpowers/specs/2026-04-01-typescript-migration-design.md`

---

### Task 1: Project setup — package.json, tsconfig, dependencies

**Files:**
- Create: `package.json`
- Create: `server/tsconfig.json`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "lgtm",
  "version": "0.1.0",
  "description": "Web-based review UI for collaborating with Claude Code",
  "type": "module",
  "scripts": {
    "build:server": "tsc -p server/tsconfig.json",
    "build:frontend": "cd frontend && npm run build",
    "build": "npm run build:server && npm run build:frontend",
    "dev": "tsx server/server.ts",
    "start": "node dist/server/server.js"
  },
  "bin": {
    "lgtm": "dist/server/server.js"
  },
  "dependencies": {
    "express": "^5.1.0",
    "open": "^10.1.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "../dist/server",
    "rootDir": ".",
    "declaration": true
  },
  "include": ["."]
}
```

- [ ] **Step 3: Create server/ directory and install dependencies**

```bash
mkdir -p server
npm install
```

Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 4: Verify TypeScript works**

Create a minimal `server/server.ts`:

```typescript
console.log('lgtm server starting');
```

Run: `npx tsx server/server.ts`
Expected: prints "lgtm server starting"

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json server/tsconfig.json server/server.ts
git commit -m "add TypeScript project setup for server migration"
```

---

### Task 2: Port git-ops.py to git-ops.ts

**Files:**
- Create: `server/git-ops.ts`

- [ ] **Step 1: Create server/git-ops.ts**

```typescript
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export function gitRun(repoPath: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    }).trim();
  } catch {
    return '';
  }
}

export function detectBaseBranch(repoPath: string): string {
  for (const candidate of ['master', 'main']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', candidate], {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return candidate;
    } catch {
      continue;
    }
  }
  return 'master';
}

export function getBranchDiff(repoPath: string, baseBranch: string): string {
  const mergeBase = gitRun(repoPath, 'merge-base', baseBranch, 'HEAD');
  if (!mergeBase) return '';

  // Committed files on the branch
  const filesOutput = gitRun(
    repoPath,
    'log', '--first-parent', '--no-merges',
    '--diff-filter=ACDMR', '--name-only', '--format=',
    `${baseBranch}..HEAD`,
  );
  const branchFiles = new Set(filesOutput.split('\n').filter(f => f.trim()));

  // Uncommitted files (staged + unstaged)
  const uncommitted = gitRun(repoPath, 'diff', '--name-only', 'HEAD');
  const staged = gitRun(repoPath, 'diff', '--name-only', '--cached');
  for (const output of [uncommitted, staged]) {
    for (const f of output.split('\n').filter(f => f.trim())) {
      branchFiles.add(f);
    }
  }

  if (branchFiles.size === 0) return '';

  return gitRun(repoPath, 'diff', mergeBase, '--', ...Array.from(branchFiles).sort());
}

export function getSelectedCommitsDiff(repoPath: string, shas: string[]): string {
  return shas
    .map(sha => gitRun(repoPath, 'diff-tree', '-p', '--no-commit-id', sha))
    .join('\n');
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export function getBranchCommits(repoPath: string, baseBranch: string): Commit[] {
  const output = gitRun(
    repoPath,
    'log', '--first-parent', '--no-merges',
    '--format=%H|%s|%an|%ar',
    `${baseBranch}..HEAD`,
  );
  const commits: Commit[] = [];
  for (const line of output.split('\n')) {
    if (!line.includes('|')) continue;
    const parts = line.split('|', 4);
    if (parts.length < 4) continue;
    commits.push({
      sha: parts[0],
      message: parts[1],
      author: parts[2],
      date: parts[3],
    });
  }
  return commits;
}

export interface RepoMeta {
  branch: string;
  baseBranch: string;
  repoPath: string;
  repoName: string;
  pr?: { url: string; number: number; title: string };
}

export function getRepoMeta(repoPath: string, baseBranch: string): RepoMeta {
  const branch = gitRun(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD');
  const meta: RepoMeta = {
    branch,
    baseBranch,
    repoPath,
    repoName: basename(repoPath),
  };
  try {
    const result = execFileSync('gh', ['pr', 'view', '--json', 'url,number,title'], {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    meta.pr = JSON.parse(result);
  } catch {
    // gh not installed or no PR
  }
  return meta;
}

export interface FileLine {
  num: number;
  content: string;
}

export function getFileLines(
  repoPath: string,
  filepath: string,
  start: number,
  count: number,
  direction: string = 'down',
): FileLine[] {
  const fullPath = join(repoPath, filepath);
  if (!existsSync(fullPath)) return [];
  const lines = readFileSync(fullPath, 'utf-8').split('\n');
  // Remove trailing empty line from split if file ends with newline
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  if (direction === 'up') {
    const end = Math.max(start - 1, 0);
    const begin = Math.max(end - count, 0);
    return Array.from({ length: end - begin }, (_, i) => ({
      num: begin + i + 1,
      content: lines[begin + i],
    }));
  } else {
    const begin = start;
    const end = Math.min(begin + count, lines.length);
    return Array.from({ length: end - begin }, (_, i) => ({
      num: begin + i + 1,
      content: lines[begin + i],
    }));
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 3: Quick smoke test**

Create a temporary test at the bottom of `server/server.ts`:

```typescript
import { detectBaseBranch, getBranchCommits } from './git-ops.js';

const repo = process.cwd();
console.log('base branch:', detectBaseBranch(repo));
console.log('commits:', getBranchCommits(repo, detectBaseBranch(repo)).length);
```

Run: `npx tsx server/server.ts`
Expected: prints the base branch and a commit count. Remove this test code after verifying.

- [ ] **Step 4: Commit**

```bash
git add server/git-ops.ts
git commit -m "port git_ops.py to TypeScript"
```

---

### Task 3: Port Session class to session.ts

**Files:**
- Create: `server/session.ts`

- [ ] **Step 1: Create server/session.ts**

```typescript
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getBranchDiff, getSelectedCommitsDiff, getRepoMeta, getFileLines,
  type RepoMeta, type FileLine,
} from './git-ops.js';

// --- Types ---

export interface SessionItem {
  id: string;
  type: 'diff' | 'document';
  title: string;
  path?: string;
}

export interface ClaudeComment {
  file?: string;
  line?: number;
  side?: 'new' | 'old';
  block?: number;
  comment: string;
}

export interface SSEClient {
  send: (event: string, data: unknown) => void;
}

// --- Session ---

export class Session {
  readonly repoPath: string;
  readonly baseBranch: string;
  readonly description: string;
  readonly outputPath: string;

  private _round = 0;
  private _items: SessionItem[] = [
    { id: 'diff', type: 'diff', title: 'Code Changes' },
  ];
  private _claudeComments: Record<string, ClaudeComment[]> = {};
  private _sseClients: SSEClient[] = [];
  private _analysis: Record<string, unknown> | null = null;

  constructor(opts: {
    repoPath: string;
    baseBranch: string;
    description?: string;
    outputPath?: string;
  }) {
    this.repoPath = opts.repoPath;
    this.baseBranch = opts.baseBranch;
    this.description = opts.description ?? '';
    this.outputPath = opts.outputPath ?? '';
  }

  // --- Queries ---

  get items(): SessionItem[] {
    return this._items;
  }

  get analysis(): Record<string, unknown> | null {
    return this._analysis;
  }

  getItemData(itemId: string, commits?: string): Record<string, unknown> {
    const claudeComments = this._claudeComments[itemId] ?? [];

    if (itemId === 'diff') {
      let diff: string;
      if (commits) {
        const shas = commits.split(',').map(s => s.trim()).filter(Boolean);
        diff = getSelectedCommitsDiff(this.repoPath, shas);
      } else {
        diff = getBranchDiff(this.repoPath, this.baseBranch);
      }
      return {
        mode: 'diff',
        diff,
        description: this.description,
        meta: getRepoMeta(this.repoPath, this.baseBranch),
        claudeComments,
      };
    }

    const item = this._items.find(i => i.id === itemId);
    if (!item) {
      return { mode: 'error', error: `Item not found: ${itemId}` };
    }

    const p = item.path!;
    const content = existsSync(p) ? readFileSync(p, 'utf-8') : '';
    const filename = p.split('/').pop()!;
    const isMarkdown = /\.(md|mdx|markdown)$/.test(filename);

    return {
      mode: 'file',
      content,
      filename,
      filepath: p,
      markdown: isMarkdown,
      title: item.title ?? filename,
      claudeComments,
    };
  }

  // --- Mutations ---

  setAnalysis(analysis: Record<string, unknown>): void {
    this._analysis = analysis;
  }

  addItem(itemId: string, title: string, filepath: string): Record<string, unknown> {
    const absPath = resolve(filepath);
    const existing = this._items.find(i => i.id === itemId);
    if (existing) {
      existing.path = absPath;
      existing.title = title;
    } else {
      this._items.push({ id: itemId, type: 'document', title, path: absPath });
    }
    return { ok: true, id: itemId, items: this._items };
  }

  addComments(itemId: string, comments: ClaudeComment[]): number {
    if (!this._claudeComments[itemId]) {
      this._claudeComments[itemId] = [];
    }
    this._claudeComments[itemId].push(...comments);
    return this._claudeComments[itemId].length;
  }

  deleteComment(itemId: string, index: number): void {
    const items = this._claudeComments[itemId];
    if (items && index >= 0 && index < items.length) {
      items.splice(index, 1);
    }
  }

  clearComments(itemId?: string): void {
    if (itemId) {
      delete this._claudeComments[itemId];
    } else {
      this._claudeComments = {};
    }
  }

  submitReview(commentsText: string): number {
    this._round++;
    const currentRound = this._round;

    appendFileSync(this.outputPath, `\n---\n# Review Round ${currentRound}\n\n${commentsText}\n`);

    writeFileSync(this.outputPath + '.signal', String(currentRound));

    return currentRound;
  }

  // --- SSE ---

  subscribe(client: SSEClient): void {
    this._sseClients.push(client);
  }

  unsubscribe(client: SSEClient): void {
    this._sseClients = this._sseClients.filter(c => c !== client);
  }

  broadcast(event: string, data: unknown): void {
    for (const client of this._sseClients) {
      try {
        client.send(event, data);
      } catch {
        // client disconnected
      }
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/session.ts
git commit -m "port Session class to TypeScript"
```

---

### Task 4: Create Express app with all routes

**Files:**
- Create: `server/app.ts`

- [ ] **Step 1: Create server/app.ts**

```typescript
import express, { type Request, type Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getFileLines, getBranchCommits,
} from './git-ops.js';
import { type Session, type SSEClient } from './session.js';

export function createApp(session: Session): express.Express {
  const app = express();
  app.use(express.json());

  // --- GET routes ---

  app.get('/items', (_req, res) => {
    res.json({ items: session.items });
  });

  app.get('/data', (req, res) => {
    const itemId = (req.query.item as string) ?? 'diff';
    const commits = req.query.commits as string | undefined;
    const data = session.getItemData(itemId, commits);
    res.json(data);
  });

  app.get('/context', (req, res) => {
    const file = (req.query.file as string) ?? '';
    const line = parseInt(req.query.line as string) || 0;
    const count = parseInt(req.query.count as string) || 20;
    const direction = (req.query.direction as string) ?? 'down';
    const lines = getFileLines(session.repoPath, file, line, count, direction);
    res.json({ lines });
  });

  app.get('/file', (req, res) => {
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

  app.get('/commits', (req, res) => {
    const commits = getBranchCommits(session.repoPath, session.baseBranch);
    res.json({ commits });
  });

  app.get('/events', (req, res) => {
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

    // Keepalive every 30s
    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30_000);

    req.on('close', () => {
      clearInterval(keepalive);
      session.unsubscribe(client);
    });
  });

  app.get('/analysis', (_req, res) => {
    res.json({ analysis: session.analysis });
  });

  // --- POST routes ---

  app.post('/items', (req, res) => {
    const { path: filepath = '', title = '', id = '' } = req.body;
    const itemTitle = title || filepath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled';
    const itemId = id || slugify(itemTitle);
    const result = session.addItem(itemId, itemTitle, filepath);
    console.log(`ITEM_ADDED=${itemId}`);
    session.broadcast('items_changed', { id: itemId });
    res.json(result);
  });

  app.post('/comments', (req, res) => {
    const itemId = req.body.item ?? 'diff';
    const newComments = req.body.comments ?? [];
    const count = session.addComments(itemId, newComments);
    console.log(`CLAUDE_COMMENTS_ADDED=${newComments.length} item=${itemId}`);
    session.broadcast('comments_changed', { item: itemId, count: newComments.length });
    res.json({ ok: true, count });
  });

  app.post('/submit', (req, res) => {
    const commentsText = req.body.comments ?? '';
    const currentRound = session.submitReview(commentsText);
    console.log(`REVIEW_ROUND=${currentRound}`);
    res.json({ ok: true, round: currentRound });
  });

  app.post('/analysis', (req, res) => {
    session.setAnalysis(req.body);
    console.log(`ANALYSIS_SET files=${Object.keys(req.body.files ?? {}).length}`);
    res.json({ ok: true });
  });

  // --- DELETE routes ---

  app.delete('/comments', (req, res) => {
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

  // --- Static files (must be last) ---

  const distDir = join(import.meta.dirname, '..', 'frontend', 'dist');
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    // SPA fallback
    app.get('*', (_req, res) => {
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
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/app.ts
git commit -m "create Express app with all routes"
```

---

### Task 5: Create CLI entry point (server.ts)

**Files:**
- Modify: `server/server.ts`

- [ ] **Step 1: Replace server/server.ts with the CLI entry point**

```typescript
#!/usr/bin/env node

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import open from 'open';
import { detectBaseBranch, gitRun } from './git-ops.js';
import { Session } from './session.js';
import { createApp } from './app.js';

function stablePortForPath(path: string): number {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h += path.charCodeAt(i) * (i + 1);
  }
  return 9850 + (h % 100);
}

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

  const repoPath = resolve(args.repo || process.cwd());
  const baseBranch = args.base || detectBaseBranch(repoPath);
  const port = args.port ? parseInt(args.port) : stablePortForPath(repoPath);
  const description = args.description || '';

  const reviewDir = '/tmp/claude-review';
  mkdirSync(reviewDir, { recursive: true });

  let outputPath: string;
  if (args.output) {
    outputPath = args.output;
  } else {
    const branch = gitRun(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD');
    const slug = branch ? branch.replace(/\//g, '-') : repoPath.split('/').pop()!;
    outputPath = `${reviewDir}/${slug}.md`;
  }

  writeFileSync(outputPath, '');

  const session = new Session({
    repoPath,
    baseBranch,
    description,
    outputPath,
  });

  const app = createApp(session);
  const url = `http://127.0.0.1:${port}`;

  app.listen(port, '127.0.0.1', () => {
    console.log(`REVIEW_URL=${url}`);
    console.log(`REVIEW_OUTPUT=${outputPath}`);
    console.log(`REVIEW_PID=${process.pid}`);
    open(url);
  });
}

main();
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 3: Test the full server**

Run: `npx tsx server/server.ts --repo /Users/tom/dev/claude-review`
Expected:
- Prints `REVIEW_URL=http://127.0.0.1:<port>`
- Prints `REVIEW_OUTPUT=/tmp/claude-review/<branch>.md`
- Prints `REVIEW_PID=<pid>`
- Opens browser
- The review UI loads and shows the diff for the current branch

- [ ] **Step 4: Commit**

```bash
git add server/server.ts
git commit -m "add CLI entry point for TypeScript server"
```

---

### Task 6: Verify API parity with curl tests

**Files:**
- No new files — manual verification

- [ ] **Step 1: Start the server**

Run in background: `npx tsx server/server.ts --repo /Users/tom/dev/claude-review &`
Note the port from the `REVIEW_URL=` output.

- [ ] **Step 2: Test GET endpoints**

```bash
# Items
curl -s http://127.0.0.1:<port>/items | python3 -m json.tool

# Data (diff)
curl -s "http://127.0.0.1:<port>/data?item=diff" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['mode'], len(d['diff']))"

# Commits
curl -s http://127.0.0.1:<port>/commits | python3 -m json.tool

# Context
curl -s "http://127.0.0.1:<port>/context?file=server/git-ops.ts&line=0&count=5&direction=down" | python3 -m json.tool

# File
curl -s "http://127.0.0.1:<port>/file?path=server/git-ops.ts" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['lines']), 'lines')"
```

Expected: all return valid JSON matching the expected shapes.

- [ ] **Step 3: Test POST endpoints**

```bash
# Add a document
curl -s -X POST http://127.0.0.1:<port>/items \
  -H 'Content-Type: application/json' \
  -d '{"path": "/Users/tom/dev/claude-review/README.md", "title": "README"}' | python3 -m json.tool

# Add a comment
curl -s -X POST http://127.0.0.1:<port>/comments \
  -H 'Content-Type: application/json' \
  -d '{"item": "diff", "comments": [{"file": "server/git-ops.ts", "line": 1, "comment": "test comment"}]}' | python3 -m json.tool

# Submit review
curl -s -X POST http://127.0.0.1:<port>/submit \
  -H 'Content-Type: application/json' \
  -d '{"comments": "test review round"}' | python3 -m json.tool
```

Expected: all return `{"ok": true, ...}`. Check that `/tmp/claude-review/<branch>.md` contains the review text.

- [ ] **Step 4: Test DELETE**

```bash
curl -s -X DELETE "http://127.0.0.1:<port>/comments?item=diff" | python3 -m json.tool
```

Expected: `{"ok": true}`

- [ ] **Step 5: Test frontend interaction**

Open the browser URL. Verify:
1. Diff view loads with files in sidebar
2. Click a line to add a comment, save it, see it rendered
3. Click Submit Review — verify feedback written to output file
4. Tab bar works (Code Changes tab active)

Kill the background server when done.

- [ ] **Step 6: Commit (if any fixes were needed)**

```bash
git add server/
git commit -m "fix API parity issues from testing"
```

---

### Task 7: Remove Python files and update configuration

**Files:**
- Delete: `server.py`
- Delete: `git_ops.py`
- Delete: `pyproject.toml`
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1: Remove Python files**

```bash
git rm server.py git_ops.py pyproject.toml
```

- [ ] **Step 2: Update .gitignore**

Replace the current `.gitignore` content with:

```
__pycache__/
*.pyc
node_modules/
dist/server/
.venv/
```

Note: `frontend/dist/` is intentionally NOT ignored — it's committed for distribution. `dist/server/` is build output and should be ignored.

- [ ] **Step 3: Update README.md Install and Architecture sections**

Update the Install section:

```markdown
## Install

Requires [Node.js](https://nodejs.org/) 20+.

\```bash
# from a local clone
npm install
npm run dev -- --repo .

# or build and run
npm run build
npm start -- --repo .
\```
```

Update the Architecture section to reference TypeScript server files instead of Python:

```markdown
## Architecture

TypeScript server with a Vite + vanilla TypeScript frontend.

\```
server/
  server.ts              -- CLI entry point
  app.ts                 -- Express app, routes, SSE
  session.ts             -- Session class, data types
  git-ops.ts             -- git operations (diff, commits, file context)
frontend/
  src/
    main.ts              -- entry point
    api.ts               -- HTTP client for server API
    state.ts             -- shared application state
    utils.ts             -- helpers (escaping, debounce, syntax detection)
    diff.ts              -- diff parsing, rendering, context expansion
    document.ts          -- markdown document view with block commenting
    comments.ts          -- comment creation, display, navigation
    ui.ts                -- sidebar, tabs, header, keyboard shortcuts
  index.html             -- shell HTML
  style.css              -- all styles
  vite.config.ts         -- Vite config with dev proxy to server
  package.json
frontend/dist/           -- production build output (served by server)
\```
```

Update the Backend section:

```markdown
### Backend (`server/`)

An Express-based TypeScript server that:

- Manages a **session** with multiple **review items** (always starts with "Code Changes" diff)
- In production, serves the built frontend from `frontend/dist/`
- Exposes a JSON API for diffs, commits, file context, comments and review submission
- Stores Claude's comments in memory, writes user feedback to disk
- Auto-detects base branch (master/main), computes stable port from repo path hash

Git operations (running git commands, parsing output) are in `server/git-ops.ts`.
```

- [ ] **Step 4: Verify everything still works**

```bash
npm run dev -- --repo /Users/tom/dev/claude-review
```

Expected: server starts, browser opens, review UI works.

- [ ] **Step 5: Commit**

```bash
git add .gitignore README.md
git commit -m "remove Python backend, update docs for TypeScript server"
```

---

### Task 8: Build verification and final cleanup

**Files:**
- Possibly minor fixes

- [ ] **Step 1: Verify full build**

```bash
npm run build
```

Expected: `dist/server/` contains compiled JS files. `frontend/dist/` contains built frontend.

- [ ] **Step 2: Verify production mode**

```bash
npm start -- --repo /Users/tom/dev/claude-review
```

Expected: server starts from compiled JS, browser opens, everything works identically to dev mode.

- [ ] **Step 3: Verify the Vite dev proxy still works**

The frontend's `vite.config.ts` has a dev proxy to the backend. Check that `cd frontend && npm run dev` still proxies API requests correctly when the TypeScript server is running separately.

Start server: `npx tsx server/server.ts --repo /Users/tom/dev/claude-review --port 9900`
Start frontend dev: `cd frontend && npm run dev`
Expected: frontend dev server proxies API calls to port 9900.

- [ ] **Step 4: Clean up any .pyc, __pycache__, .venv artifacts**

```bash
rm -rf __pycache__ .venv
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "verify build and clean up Python artifacts"
```
