# SQLite Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ephemeral in-memory server state and browser localStorage with a unified SQLite-backed store so all session data (documents, claude comments, user comments, reviewed files, resolved comments, analysis) survives server restarts and works across browsers.

**Architecture:** A single SQLite database at a well-known path (`~/.lgtm/data.db`) stores one JSON blob per project slug. The Session class reads from and writes through to the store on every mutation. The frontend drops localStorage entirely and fetches/mutates all state via HTTP endpoints. SSE continues to push live updates.

**Tech Stack:** better-sqlite3 (synchronous, fast, zero-config), existing Express routes, existing SSE infrastructure.

---

## File Structure

```
server/
  store.ts          — NEW: SQLite wrapper (open db, get/put/delete JSON blobs)
  session.ts        — MODIFY: read/write through to store on every mutation; add user-state fields
  session-manager.ts — MODIFY: restore sessions from store on startup; pass store to Session
  app.ts            — MODIFY: add user-state endpoints (GET/PUT/DELETE for comments, reviewed, resolved)
  server.ts         — no changes
  mcp.ts            — no changes
frontend/
  src/
    api.ts          — MODIFY: add user-state API calls
    persistence.ts  — MODIFY: gut localStorage, replace with server API calls
    state.ts        — no changes (mutable state objects stay the same shape)
    comments.ts     — MODIFY: call persistence.saveState() where it already does (no structural change)
    document.ts     — no changes (already calls saveState())
    claude-comments.ts — MODIFY: call saveState() after reply/resolve/unresolve mutations
    ui.ts           — no changes (already calls saveState())
    file-list.ts    — no changes (already calls saveState())
    main.ts         — MODIFY: await loadState() (now async, fetches from server)
```

## Design Decisions

**Why a JSON blob per slug (not normalized tables)?** The data is small, access patterns are always "load everything for this project" or "update one field for this project", and the shape is identical to what Session already holds in memory. Normalizing into tables buys nothing and adds migration burden.

**Why better-sqlite3 (sync) over sqlite3 (async)?** Every write is a single `UPDATE ... SET data = ? WHERE slug = ?` — sub-millisecond. Async overhead and callback complexity aren't justified. better-sqlite3 is also the most common choice in the Node/SQLite ecosystem.

**What about the review output file (`/tmp/claude-review/<slug>.md`)?** Keep it. The MCP `review_read_feedback` tool reads from it, and the signal file mechanism works. The SQLite store is for live session state, not the submitted review artifact.

**User state scoping:** User comments, reviewed files, and resolved comments are stored inside the same per-slug JSON blob. This means all browsers sharing a project URL share the same user state. This is intentional — LGTM is single-user-per-project.

---

### Task 1: Add better-sqlite3 dependency and create store module

**Files:**
- Modify: `package.json` (add better-sqlite3 + @types)
- Create: `server/store.ts`

- [ ] **Step 1: Install better-sqlite3**

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

- [ ] **Step 2: Create `server/store.ts`**

```typescript
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface ProjectBlob {
  slug: string;
  repoPath: string;
  baseBranch: string;
  description: string;
  items: { id: string; type: 'diff' | 'document'; title: string; path?: string }[];
  claudeComments: Record<string, { file?: string; line?: number; side?: string; block?: number; comment: string }[]>;
  analysis: Record<string, unknown> | null;
  round: number;
  userComments: Record<string, string>;
  reviewedFiles: string[];
  resolvedComments: string[];
  sidebarView: string;
}

const DB_DIR = join(homedir(), '.lgtm');
const DB_PATH = join(DB_DIR, 'data.db');

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (!_db) {
    mkdirSync(DB_DIR, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        slug TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )
    `);
  }
  return _db;
}

export function storeGet(slug: string): ProjectBlob | null {
  const row = db().prepare('SELECT data FROM projects WHERE slug = ?').get(slug) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

export function storePut(slug: string, blob: ProjectBlob): void {
  db().prepare(
    'INSERT INTO projects (slug, data) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET data = excluded.data'
  ).run(slug, JSON.stringify(blob));
}

export function storeDelete(slug: string): void {
  db().prepare('DELETE FROM projects WHERE slug = ?').run(slug);
}

export function storeList(): ProjectBlob[] {
  const rows = db().prepare('SELECT data FROM projects').all() as { data: string }[];
  return rows.map(r => JSON.parse(r.data));
}
```

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit -p server/tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json server/store.ts
git commit -m "add better-sqlite3 and store module for SQLite persistence"
```

---

### Task 2: Wire Session to read/write through the store

**Files:**
- Modify: `server/session.ts`

The Session class gains user-state fields (`userComments`, `reviewedFiles`, `resolvedComments`, `sidebarView`) and a `persist()` method that serializes to a `ProjectBlob` and writes it to the store. Every mutation method calls `persist()` at the end.

Session also gets a static `fromBlob()` factory for restoring from the store.

- [ ] **Step 1: Add user-state fields and persist imports to Session**

In `server/session.ts`, add imports and new fields:

```typescript
import { storeGet, storePut, type ProjectBlob } from './store.js';
```

Add new private fields after the existing ones:

```typescript
  private _slug: string = '';
  private _userComments: Record<string, string> = {};
  private _reviewedFiles = new Set<string>();
  private _resolvedComments = new Set<string>();
  private _sidebarView = 'flat';
```

Add `slug` to the constructor options interface and assign it:

```typescript
constructor(opts: {
  repoPath: string;
  baseBranch: string;
  description?: string;
  outputPath?: string;
  slug?: string;
}) {
  // ... existing assignments ...
  this._slug = opts.slug ?? '';
}
```

- [ ] **Step 2: Add the `toBlob()` and `persist()` methods**

```typescript
  toBlob(): ProjectBlob {
    return {
      slug: this._slug,
      repoPath: this.repoPath,
      baseBranch: this.baseBranch,
      description: this.description,
      items: this._items,
      claudeComments: this._claudeComments,
      analysis: this._analysis,
      round: this._round,
      userComments: this._userComments,
      reviewedFiles: Array.from(this._reviewedFiles),
      resolvedComments: Array.from(this._resolvedComments),
      sidebarView: this._sidebarView,
    };
  }

  persist(): void {
    if (!this._slug) return;
    storePut(this._slug, this.toBlob());
  }
```

- [ ] **Step 3: Add the static `fromBlob()` factory**

```typescript
  static fromBlob(blob: ProjectBlob, outputPath: string): Session {
    const session = new Session({
      repoPath: blob.repoPath,
      baseBranch: blob.baseBranch,
      description: blob.description,
      outputPath,
      slug: blob.slug,
    });
    session._items = blob.items;
    session._claudeComments = blob.claudeComments;
    session._analysis = blob.analysis;
    session._round = blob.round;
    session._userComments = blob.userComments ?? {};
    session._reviewedFiles = new Set(blob.reviewedFiles ?? []);
    session._resolvedComments = new Set(blob.resolvedComments ?? []);
    session._sidebarView = blob.sidebarView ?? 'flat';
    return session;
  }
```

- [ ] **Step 4: Add user-state getters and mutators**

```typescript
  get userComments(): Record<string, string> {
    return this._userComments;
  }

  get userReviewedFiles(): string[] {
    return Array.from(this._reviewedFiles);
  }

  get userResolvedComments(): string[] {
    return Array.from(this._resolvedComments);
  }

  get userSidebarView(): string {
    return this._sidebarView;
  }

  setUserComment(key: string, text: string): void {
    this._userComments[key] = text;
    this.persist();
  }

  deleteUserComment(key: string): void {
    delete this._userComments[key];
    this.persist();
  }

  setUserReviewedFiles(files: string[]): void {
    this._reviewedFiles = new Set(files);
    this.persist();
  }

  toggleUserReviewedFile(path: string): boolean {
    const nowReviewed = !this._reviewedFiles.has(path);
    if (nowReviewed) this._reviewedFiles.add(path);
    else this._reviewedFiles.delete(path);
    this.persist();
    return nowReviewed;
  }

  setUserResolvedComments(keys: string[]): void {
    this._resolvedComments = new Set(keys);
    this.persist();
  }

  toggleUserResolvedComment(key: string): boolean {
    const nowResolved = !this._resolvedComments.has(key);
    if (nowResolved) this._resolvedComments.add(key);
    else this._resolvedComments.delete(key);
    this.persist();
    return nowResolved;
  }

  setUserSidebarView(view: string): void {
    this._sidebarView = view;
    this.persist();
  }
```

- [ ] **Step 5: Add `persist()` calls to existing mutation methods**

Add `this.persist()` as the last line of each of these existing methods:
- `setAnalysis()`
- `addItem()`
- `addComments()`
- `deleteComment()`
- `clearComments()`
- `submitReview()` (after incrementing round)

- [ ] **Step 6: Verify it compiles**

```bash
npx tsc --noEmit -p server/tsconfig.json
```

- [ ] **Step 7: Commit**

```bash
git add server/session.ts
git commit -m "wire Session to persist all state through SQLite store"
```

---

### Task 3: Restore sessions from SQLite on startup

**Files:**
- Modify: `server/session-manager.ts`

SessionManager restores all projects from the store on construction, and passes slugs to new Sessions so they can persist. On deregister, it deletes from the store.

- [ ] **Step 1: Update SessionManager to restore from store**

Add import:

```typescript
import { storeGet, storeList, storeDelete } from './store.js';
```

In the constructor, after `mkdirSync`, restore sessions:

```typescript
  constructor(port: number) {
    this._port = port;
    mkdirSync(REVIEW_DIR, { recursive: true });

    // Restore persisted sessions
    for (const blob of storeList()) {
      const outputPath = `${REVIEW_DIR}/${blob.slug}.md`;
      const session = Session.fromBlob(blob, outputPath);
      this._sessions.set(blob.slug, session);
      console.log(`SESSION_RESTORED=${blob.slug} path=${blob.repoPath}`);
    }
  }
```

Add `Session` import if not already present:

```typescript
import { Session } from './session.js';
```

- [ ] **Step 2: Pass slug to new Sessions in `register()`**

In the `register()` method, after `const slug = this._deriveSlug(absPath);`, update the Session constructor call to include the slug:

```typescript
    const session = new Session({
      repoPath: absPath,
      baseBranch,
      description: opts?.description ?? '',
      outputPath,
      slug,
    });
```

Also add an explicit `session.persist()` call after constructing the session (before `this._sessions.set()`):

```typescript
    session.persist();
    this._sessions.set(slug, session);
```

- [ ] **Step 3: Delete from store on deregister**

Update the `deregister()` method:

```typescript
  deregister(slug: string): boolean {
    const removed = this._sessions.delete(slug);
    if (removed) storeDelete(slug);
    return removed;
  }
```

- [ ] **Step 4: Verify it compiles**

```bash
npx tsc --noEmit -p server/tsconfig.json
```

- [ ] **Step 5: Test manually**

Start the dev server, register a project, add a document via MCP or UI, restart the server, and verify the document tab reappears.

```bash
npm run dev -- --repo . --port 9900
# (in another terminal) restart the server — document tabs should survive
```

- [ ] **Step 6: Commit**

```bash
git add server/session-manager.ts
git commit -m "restore sessions from SQLite on server startup"
```

---

### Task 4: Add user-state API endpoints

**Files:**
- Modify: `server/app.ts`

Add endpoints for the frontend to read and write user state (comments, reviewed files, resolved comments, sidebar view). These go on the existing `projectRouter`.

- [ ] **Step 1: Add GET endpoint for user state**

After the existing `projectRouter.get('/analysis', ...)` block, add:

```typescript
  projectRouter.get('/user-state', (_req, res) => {
    const session = res.locals.session;
    res.json({
      comments: session.userComments,
      reviewedFiles: session.userReviewedFiles,
      resolvedComments: session.userResolvedComments,
      sidebarView: session.userSidebarView,
    });
  });
```

- [ ] **Step 2: Add PUT endpoint for user comments**

```typescript
  projectRouter.put('/user-state/comment', (req, res) => {
    const session = res.locals.session;
    const { key, text } = req.body;
    if (!key) {
      res.status(400).json({ error: 'key is required' });
      return;
    }
    if (text) {
      session.setUserComment(key, text);
    } else {
      session.deleteUserComment(key);
    }
    res.json({ ok: true });
  });
```

- [ ] **Step 3: Add PUT endpoint for reviewed files toggle**

```typescript
  projectRouter.put('/user-state/reviewed', (req, res) => {
    const session = res.locals.session;
    const { path } = req.body;
    if (!path) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const reviewed = session.toggleUserReviewedFile(path);
    res.json({ ok: true, reviewed });
  });
```

- [ ] **Step 4: Add PUT endpoint for resolved comments toggle**

```typescript
  projectRouter.put('/user-state/resolved', (req, res) => {
    const session = res.locals.session;
    const { key } = req.body;
    if (!key) {
      res.status(400).json({ error: 'key is required' });
      return;
    }
    const resolved = session.toggleUserResolvedComment(key);
    res.json({ ok: true, resolved });
  });
```

- [ ] **Step 5: Add PUT endpoint for sidebar view**

```typescript
  projectRouter.put('/user-state/sidebar-view', (req, res) => {
    const session = res.locals.session;
    const { view } = req.body;
    if (!view || !['flat', 'grouped', 'phased'].includes(view)) {
      res.status(400).json({ error: 'view must be flat, grouped, or phased' });
      return;
    }
    session.setUserSidebarView(view);
    res.json({ ok: true });
  });
```

- [ ] **Step 6: Add POST endpoint to clear user state on submit**

```typescript
  projectRouter.post('/user-state/clear', (_req, res) => {
    const session = res.locals.session;
    for (const key of Object.keys(session.userComments)) {
      session.deleteUserComment(key);
    }
    session.setUserReviewedFiles([]);
    session.setUserResolvedComments([]);
    res.json({ ok: true });
  });
```

- [ ] **Step 7: Verify it compiles**

```bash
npx tsc --noEmit -p server/tsconfig.json
```

- [ ] **Step 8: Commit**

```bash
git add server/app.ts
git commit -m "add user-state API endpoints for comments, reviewed, resolved, sidebar view"
```

---

### Task 5: Add API client functions for user state

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add fetchUserState function**

```typescript
interface UserState {
  comments: Record<string, string>;
  reviewedFiles: string[];
  resolvedComments: string[];
  sidebarView: string;
}

export async function fetchUserState(): Promise<UserState> {
  const resp = await fetch(`${baseUrl()}/user-state`);
  return checkedJson<UserState>(resp);
}
```

- [ ] **Step 2: Add mutation functions**

```typescript
export async function putUserComment(key: string, text: string | null): Promise<void> {
  await fetch(`${baseUrl()}/user-state/comment`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, text }),
  });
}

export async function putUserReviewed(path: string): Promise<void> {
  await fetch(`${baseUrl()}/user-state/reviewed`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

export async function putUserResolved(key: string): Promise<void> {
  await fetch(`${baseUrl()}/user-state/resolved`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
}

export async function putUserSidebarView(view: string): Promise<void> {
  await fetch(`${baseUrl()}/user-state/sidebar-view`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ view }),
  });
}

export async function clearUserState(): Promise<void> {
  await fetch(`${baseUrl()}/user-state/clear`, { method: 'POST' });
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.ts
git commit -m "add frontend API client for user-state endpoints"
```

---

### Task 6: Replace localStorage persistence with server-backed persistence

**Files:**
- Modify: `frontend/src/persistence.ts`
- Modify: `frontend/src/main.ts`

The persistence module becomes a thin layer that fires-and-forgets API calls on mutation, and loads initial state from the server on startup.

- [ ] **Step 1: Rewrite `persistence.ts`**

Replace the entire contents of `frontend/src/persistence.ts` with:

```typescript
import { comments, reviewedFiles, resolvedComments, sidebarView } from './state';
import type { SidebarView } from './state';
import { setSidebarView } from './state';
import {
  fetchUserState,
  putUserComment,
  putUserReviewed,
  putUserResolved,
  putUserSidebarView,
  clearUserState,
} from './api';

// Track keys to detect additions and deletions
let lastCommentKeys = new Set<string>();
let lastReviewedFiles = new Set<string>();
let lastResolvedComments = new Set<string>();
let lastSidebarView = '';

export async function loadState(): Promise<void> {
  try {
    const state = await fetchUserState();

    if (state.comments) {
      for (const [key, value] of Object.entries(state.comments)) {
        comments[key] = value;
      }
    }

    if (state.reviewedFiles) {
      for (const path of state.reviewedFiles) {
        reviewedFiles.add(path);
      }
    }

    if (state.resolvedComments) {
      for (const key of state.resolvedComments) {
        resolvedComments.add(key);
      }
    }

    if (state.sidebarView && ['flat', 'grouped', 'phased'].includes(state.sidebarView)) {
      setSidebarView(state.sidebarView as SidebarView);
    }

    // Snapshot current state for diffing
    lastCommentKeys = new Set(Object.keys(comments));
    lastReviewedFiles = new Set(reviewedFiles);
    lastResolvedComments = new Set(resolvedComments);
    lastSidebarView = sidebarView;
  } catch {
    /* server unavailable — start fresh */
  }
}

export function saveState(): void {
  // Send full current state to server. All endpoints are idempotent
  // and the server is localhost, so redundant writes are cheap.

  // Comments: sync all keys
  const currentKeys = new Set(Object.keys(comments));
  for (const key of currentKeys) {
    putUserComment(key, comments[key]);
  }
  for (const key of lastCommentKeys) {
    if (!currentKeys.has(key)) putUserComment(key, null);
  }
  lastCommentKeys = new Set(currentKeys);

  // Reviewed files: toggle any that changed
  for (const path of reviewedFiles) {
    if (!lastReviewedFiles.has(path)) putUserReviewed(path);
  }
  for (const path of lastReviewedFiles) {
    if (!reviewedFiles.has(path)) putUserReviewed(path);
  }
  lastReviewedFiles = new Set(reviewedFiles);

  // Resolved comments: toggle any that changed
  for (const key of resolvedComments) {
    if (!lastResolvedComments.has(key)) putUserResolved(key);
  }
  for (const key of lastResolvedComments) {
    if (!resolvedComments.has(key)) putUserResolved(key);
  }
  lastResolvedComments = new Set(resolvedComments);

  // Sidebar view
  if (sidebarView !== lastSidebarView) {
    putUserSidebarView(sidebarView);
    lastSidebarView = sidebarView;
  }
}

export async function clearPersistedState(): Promise<void> {
  lastCommentKeys = new Set();
  lastReviewedFiles = new Set();
  lastResolvedComments = new Set();
  await clearUserState();
}
```

- [ ] **Step 2: Update `main.ts` to await loadState()**

`loadState()` is now async. In `main.ts`, the `init()` function already awaits things. Change the call:

```typescript
// Old:
loadState();

// New:
await loadState();
```

- [ ] **Step 3: Remove localStorage migration (one-time cleanup)**

Also in `main.ts`, after the `await loadState()` call, add a one-time migration that moves any existing localStorage data to the server and then clears it:

```typescript
  // One-time migration from localStorage
  const legacyKey = 'lgtm-review-state';
  const legacy = localStorage.getItem(legacyKey);
  if (legacy) {
    localStorage.removeItem(legacyKey);
    // Data was loaded from server; if server had nothing, the legacy
    // data is already stale. Don't merge — just discard.
  }
```

- [ ] **Step 4: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/persistence.ts frontend/src/main.ts
git commit -m "replace localStorage with server-backed persistence"
```

---

### Task 7: Wire claude-comments.ts to save state on mutations

**Files:**
- Modify: `frontend/src/claude-comments.ts`

Currently, reply/resolve/unresolve actions mutate `comments` and `resolvedComments` directly without calling `saveState()`. These need to persist.

- [ ] **Step 1: Add saveState import and calls**

Add import at the top of `frontend/src/claude-comments.ts`:

```typescript
import { saveState } from './persistence';
```

Add `saveState()` calls after each mutation in `handleClaudeCommentAction()`:

- After `resolvedComments.add(...)` in the Resolve block
- After `resolvedComments.delete(...)` in the Unresolve block
- After `delete comments[...]` in the Delete reply block

And in the `save` closure inside `openReplyTextarea()`:

- After `comments[ccKey] = trimmed` and after `delete comments[ccKey]`

Specifically, the `save` closure becomes:

```typescript
  const save = () => {
    const trimmed = textarea.value.trim();
    if (trimmed) comments[ccKey] = trimmed;
    else delete comments[ccKey];
    saveState();
    rerender();
  };
```

And in `handleClaudeCommentAction`, after each `resolvedComments.add/delete` call and after `delete comments[...]`, add `saveState();` before `rerender();`.

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/claude-comments.ts
git commit -m "persist claude comment interactions (reply, resolve) to server"
```

---

### Task 8: Include user state in item data responses

**Files:**
- Modify: `server/session.ts` (the `getItemData` method)

The `GET /data` response should include user comments relevant to the current item, so the frontend can render them without a separate fetch. This is optional but reduces the number of round-trips on initial load.

- [ ] **Step 1: Add userComments to getItemData response**

In the `getItemData` method, add `userComments: this._userComments` to both the diff and file return objects:

For the diff case:
```typescript
      return {
        mode: 'diff',
        diff,
        description: this.description,
        meta: getRepoMeta(this.repoPath, this.baseBranch),
        claudeComments,
        userComments: this._userComments,
      };
```

For the file case:
```typescript
      return {
        mode: 'file',
        content,
        filename,
        filepath: p,
        markdown: isMarkdown,
        title: item.title ?? filename,
        claudeComments,
        userComments: this._userComments,
      };
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit -p server/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add server/session.ts
git commit -m "include user comments in item data responses"
```

---

### Task 9: Build and manual end-to-end test

**Files:**
- No new files

- [ ] **Step 1: Build everything**

```bash
npm run build
```

- [ ] **Step 2: Test the full flow**

```bash
npm run dev -- --repo . --port 9900
```

Test each of these:
1. Open the browser, add a comment on a diff line — refresh the page, comment should survive
2. Mark a file as reviewed (click or `e` key) — refresh, checkmark should persist
3. Add a document via MCP — restart the server, document tab should reappear
4. Resolve a Claude comment — refresh, resolved state should persist
5. Change sidebar view to "grouped" — refresh, view should persist
6. Submit a review — user comments should clear
7. Open in a different browser/incognito — same state should appear

- [ ] **Step 3: Verify SQLite database exists**

```bash
ls -la ~/.lgtm/data.db
```

- [ ] **Step 4: Commit dist/**

```bash
git add frontend/dist/
git commit -m "rebuild frontend dist with server-backed persistence"
```

---

## Notes for implementer

- **Fire-and-forget writes:** The frontend `putUser*` functions don't await. This is intentional — we don't want to block the UI on network round-trips. The server is localhost, latency is sub-millisecond. If a write fails, the worst case is the state is stale on next refresh.

- **No debouncing on the server side:** Every `persist()` call writes to SQLite immediately. With WAL mode and the data being <100KB per project, this is fine. Don't add a write buffer.

- **The `lastCommentKeys` diffing pattern:** This detects which keys changed since the last save, so we only send deltas to the server instead of the full state. It's not perfect (it won't detect a value change if the key already existed), but the simple version is: on every `saveState()`, just send all current comment keys. The server's `setUserComment` is idempotent so repeats are harmless. If the diff approach causes bugs, simplify to sending all keys.

- **`clearPersistedState` is now async:** It's only called from `handleSubmitReview` in `ui.ts`. Make sure to `await` it there (or fire-and-forget since submit already POSTs to the server).
