# Unified Comment Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LGTM's three separate comment data structures with a single unified `Comment` model, add a REST API for comments, and enable comments in whole-file view.

**Architecture:** Extract comment management into a `CommentStore` class that Session delegates to. Replace scattered API routes with a CRUD `/comments` resource. Migrate frontend from local-first comment state to server-as-source-of-truth via the new API. Add comment rendering to the existing whole-file view.

**Tech Stack:** TypeScript, Express, Vitest, vanilla DOM (frontend)

---

## File Structure

**Server — new files:**
- `server/comment-store.ts` — `CommentStore` class: pure comment CRUD, no side effects
- `server/comment-types.ts` — `Comment` interface and related types
- `server/comment-migration.ts` — converts old `ProjectBlob` shape to new format

**Server — modified files:**
- `server/session.ts` — replace `_claudeComments`, `_userComments`, `_resolvedComments` with `CommentStore`
- `server/store.ts` — update `ProjectBlob` type
- `server/app.ts` — replace comment/user-state routes with CRUD `/comments` resource
- `server/mcp.ts` — update `comment` MCP tool to use new API

**Frontend — new files:**
- `frontend/src/comment-api.ts` — client for the new `/comments` REST API
- `frontend/src/comment-types.ts` — shared `Comment` type (mirrors server)

**Frontend — modified files:**
- `frontend/src/state.ts` — replace `comments` map, `claudeComments` array, `resolvedComments` set with `comments: Comment[]`
- `frontend/src/api.ts` — remove old comment-related functions
- `frontend/src/persistence.ts` — simplify to only handle reviewed files + sidebar view
- `frontend/src/comments.ts` — refactor to use unified `Comment` type
- `frontend/src/claude-comments.ts` — refactor to use unified `Comment` type
- `frontend/src/diff.ts` — use new comment types for rendering; add comments to whole-file view
- `frontend/src/document.ts` — use new comment types for rendering
- `frontend/src/ui.ts` — update tab badges, submit flow
- `frontend/src/main.ts` — update SSE handlers, load comments from new API

**Tests:**
- `server/comment-store.test.ts` — CommentStore unit tests
- `server/comment-migration.test.ts` — migration tests
- `frontend/src/__tests__/comment-types.test.ts` — type/filter tests

---

### Task 1: Comment types

**Files:**
- Create: `server/comment-types.ts`
- Create: `frontend/src/comment-types.ts`

- [ ] **Step 1: Create server comment types**

```typescript
// server/comment-types.ts

export interface Comment {
  id: string;
  author: 'user' | 'claude';
  text: string;
  status: 'active' | 'resolved' | 'dismissed';
  parentId?: string;
  item: string;
  file?: string;
  line?: number;
  block?: number;
  mode?: 'review' | 'direct';
}

export type CommentFilter = {
  item?: string;
  file?: string;
  author?: 'user' | 'claude';
  parentId?: string;
  mode?: 'review' | 'direct';
  status?: 'active' | 'resolved' | 'dismissed';
};

export type CreateComment = Omit<Comment, 'id' | 'status'>;
```

- [ ] **Step 2: Create frontend comment types**

```typescript
// frontend/src/comment-types.ts

export interface Comment {
  id: string;
  author: 'user' | 'claude';
  text: string;
  status: 'active' | 'resolved' | 'dismissed';
  parentId?: string;
  item: string;
  file?: string;
  line?: number;
  block?: number;
  mode?: 'review' | 'direct';
}
```

- [ ] **Step 3: Commit**

```bash
git add server/comment-types.ts frontend/src/comment-types.ts
git commit -m "add unified Comment type for server and frontend"
```

---

### Task 2: CommentStore

**Files:**
- Create: `server/comment-store.ts`
- Create: `server/comment-store.test.ts`

- [ ] **Step 1: Write failing tests for CommentStore**

Create `server/comment-store.test.ts`. Since there's no server test runner yet, first install vitest at root:

```bash
cd /Users/tom/dev/claude-review && npm install -D vitest
```

Then write the tests:

```typescript
// server/comment-store.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { CommentStore } from './comment-store.js';

describe('CommentStore', () => {
  let store: CommentStore;

  beforeEach(() => {
    store = new CommentStore();
  });

  it('adds a comment and assigns an id and active status', () => {
    const comment = store.add({
      author: 'claude',
      text: 'Looks risky',
      item: 'diff',
      file: 'src/foo.ts',
      line: 42,
    });
    expect(comment.id).toBeDefined();
    expect(comment.status).toBe('active');
    expect(comment.text).toBe('Looks risky');
  });

  it('retrieves a comment by id', () => {
    const added = store.add({ author: 'user', text: 'Why?', item: 'diff', file: 'src/foo.ts', line: 10, mode: 'review' });
    expect(store.get(added.id)).toEqual(added);
  });

  it('returns undefined for unknown id', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('updates text', () => {
    const c = store.add({ author: 'user', text: 'old', item: 'diff', mode: 'review' });
    store.update(c.id, { text: 'new' });
    expect(store.get(c.id)!.text).toBe('new');
  });

  it('updates status', () => {
    const c = store.add({ author: 'claude', text: 'Check this', item: 'diff' });
    store.update(c.id, { status: 'resolved' });
    expect(store.get(c.id)!.status).toBe('resolved');
  });

  it('deletes a comment', () => {
    const c = store.add({ author: 'claude', text: 'x', item: 'diff' });
    expect(store.delete(c.id)).toBe(true);
    expect(store.get(c.id)).toBeUndefined();
    expect(store.delete(c.id)).toBe(false);
  });

  it('filters by item', () => {
    store.add({ author: 'claude', text: 'a', item: 'diff' });
    store.add({ author: 'claude', text: 'b', item: 'spec' });
    expect(store.list({ item: 'diff' })).toHaveLength(1);
    expect(store.list({ item: 'spec' })).toHaveLength(1);
  });

  it('filters by author', () => {
    store.add({ author: 'claude', text: 'a', item: 'diff' });
    store.add({ author: 'user', text: 'b', item: 'diff', mode: 'review' });
    expect(store.list({ author: 'claude' })).toHaveLength(1);
    expect(store.list({ author: 'user' })).toHaveLength(1);
  });

  it('filters by file', () => {
    store.add({ author: 'claude', text: 'a', item: 'diff', file: 'src/a.ts' });
    store.add({ author: 'claude', text: 'b', item: 'diff', file: 'src/b.ts' });
    expect(store.list({ file: 'src/a.ts' })).toHaveLength(1);
  });

  it('filters by parentId', () => {
    const root = store.add({ author: 'claude', text: 'root', item: 'diff' });
    store.add({ author: 'user', text: 'reply', item: 'diff', parentId: root.id });
    expect(store.list({ parentId: root.id })).toHaveLength(1);
  });

  it('filters by status', () => {
    const c = store.add({ author: 'claude', text: 'a', item: 'diff' });
    store.update(c.id, { status: 'dismissed' });
    store.add({ author: 'claude', text: 'b', item: 'diff' });
    expect(store.list({ status: 'active' })).toHaveLength(1);
    expect(store.list({ status: 'dismissed' })).toHaveLength(1);
  });

  it('combines filters', () => {
    store.add({ author: 'claude', text: 'a', item: 'diff', file: 'src/a.ts' });
    store.add({ author: 'user', text: 'b', item: 'diff', file: 'src/a.ts', mode: 'review' });
    store.add({ author: 'claude', text: 'c', item: 'diff', file: 'src/b.ts' });
    expect(store.list({ author: 'claude', file: 'src/a.ts' })).toHaveLength(1);
  });

  it('serializes and deserializes', () => {
    store.add({ author: 'claude', text: 'a', item: 'diff' });
    store.add({ author: 'user', text: 'b', item: 'diff', mode: 'review' });
    const json = store.toJSON();
    const restored = CommentStore.fromJSON(json);
    expect(restored.list()).toEqual(store.list());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/tom/dev/claude-review && npx vitest run server/comment-store.test.ts
```

Expected: FAIL — `comment-store.ts` doesn't exist yet.

- [ ] **Step 3: Implement CommentStore**

```typescript
// server/comment-store.ts

import type { Comment, CommentFilter, CreateComment } from './comment-types.js';

export class CommentStore {
  private _comments: Comment[] = [];

  add(input: CreateComment): Comment {
    const comment: Comment = {
      ...input,
      id: crypto.randomUUID(),
      status: 'active',
    };
    this._comments.push(comment);
    return comment;
  }

  get(id: string): Comment | undefined {
    return this._comments.find(c => c.id === id);
  }

  update(id: string, fields: Partial<Pick<Comment, 'text' | 'status'>>): Comment | undefined {
    const comment = this.get(id);
    if (!comment) return undefined;
    if (fields.text !== undefined) comment.text = fields.text;
    if (fields.status !== undefined) comment.status = fields.status;
    return comment;
  }

  delete(id: string): boolean {
    const idx = this._comments.findIndex(c => c.id === id);
    if (idx === -1) return false;
    this._comments.splice(idx, 1);
    return true;
  }

  list(filter?: CommentFilter): Comment[] {
    if (!filter) return [...this._comments];
    return this._comments.filter(c => {
      if (filter.item !== undefined && c.item !== filter.item) return false;
      if (filter.file !== undefined && c.file !== filter.file) return false;
      if (filter.author !== undefined && c.author !== filter.author) return false;
      if (filter.parentId !== undefined && c.parentId !== filter.parentId) return false;
      if (filter.mode !== undefined && c.mode !== filter.mode) return false;
      if (filter.status !== undefined && c.status !== filter.status) return false;
      return true;
    });
  }

  toJSON(): Comment[] {
    return [...this._comments];
  }

  static fromJSON(data: Comment[]): CommentStore {
    const store = new CommentStore();
    store._comments = [...data];
    return store;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/tom/dev/claude-review && npx vitest run server/comment-store.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/comment-store.ts server/comment-store.test.ts
git commit -m "add CommentStore with full CRUD and filtering"
```

---

### Task 3: Comment migration

**Files:**
- Create: `server/comment-migration.ts`
- Create: `server/comment-migration.test.ts`

- [ ] **Step 1: Write failing tests for migration**

```typescript
// server/comment-migration.test.ts

import { describe, it, expect } from 'vitest';
import { migrateBlob } from './comment-migration.js';

describe('migrateBlob', () => {
  it('converts old-format blob to new format with comments array', () => {
    const oldBlob = {
      slug: 'test',
      repoPath: '/tmp/repo',
      baseBranch: 'main',
      description: '',
      items: [{ id: 'diff', type: 'diff' as const, title: 'Code Changes' }],
      claudeComments: {
        diff: [
          { id: 'cc-1', file: 'src/foo.ts', line: 10, comment: 'Check this' },
          { id: 'cc-2', file: 'src/bar.ts', line: 5, block: undefined, comment: 'Also here' },
        ],
      },
      analysis: null,
      round: 1,
      userComments: {
        'src/foo.ts::3': 'User note on line',
        'doc:spec:2': 'Doc comment',
        'claude:cc-1': 'Reply to Claude',
      },
      reviewedFiles: ['src/foo.ts'],
      resolvedComments: ['claude:cc-2'],
      sidebarView: 'flat',
    };

    const result = migrateBlob(oldBlob);

    // Should have comments array
    expect(result.comments).toBeDefined();
    expect(Array.isArray(result.comments)).toBe(true);

    // Old fields should be removed
    expect(result).not.toHaveProperty('claudeComments');
    expect(result).not.toHaveProperty('userComments');
    expect(result).not.toHaveProperty('resolvedComments');

    // Claude comments migrated
    const claudeComments = result.comments.filter((c: any) => c.author === 'claude' && !c.parentId);
    expect(claudeComments).toHaveLength(2);
    expect(claudeComments[0].text).toBe('Check this');
    expect(claudeComments[0].file).toBe('src/foo.ts');
    expect(claudeComments[0].item).toBe('diff');
    expect(claudeComments[0].status).toBe('active');

    // Resolved Claude comment
    const resolved = result.comments.find((c: any) => c.id === 'cc-2');
    expect(resolved.status).toBe('resolved');

    // User diff comment migrated
    const userDiffComments = result.comments.filter((c: any) => c.author === 'user' && c.file === 'src/foo.ts' && !c.parentId);
    expect(userDiffComments).toHaveLength(1);
    expect(userDiffComments[0].text).toBe('User note on line');
    expect(userDiffComments[0].mode).toBe('review');
    expect(userDiffComments[0].item).toBe('diff');

    // User doc comment migrated
    const userDocComments = result.comments.filter((c: any) => c.author === 'user' && c.item === 'spec');
    expect(userDocComments).toHaveLength(1);
    expect(userDocComments[0].text).toBe('Doc comment');
    expect(userDocComments[0].block).toBe(2);

    // Reply to Claude migrated
    const replies = result.comments.filter((c: any) => c.parentId === 'cc-1');
    expect(replies).toHaveLength(1);
    expect(replies[0].author).toBe('user');
    expect(replies[0].text).toBe('Reply to Claude');
  });

  it('passes through new-format blob unchanged', () => {
    const newBlob = {
      slug: 'test',
      repoPath: '/tmp/repo',
      baseBranch: 'main',
      description: '',
      items: [],
      comments: [{ id: 'c1', author: 'claude', text: 'hi', status: 'active', item: 'diff' }],
      analysis: null,
      round: 0,
      reviewedFiles: [],
      sidebarView: 'flat',
    };

    const result = migrateBlob(newBlob);
    expect(result.comments).toEqual(newBlob.comments);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/tom/dev/claude-review && npx vitest run server/comment-migration.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement migration**

```typescript
// server/comment-migration.ts

import type { Comment } from './comment-types.js';

interface OldClaudeComment {
  id: string;
  file?: string;
  line?: number;
  side?: string;
  block?: number;
  comment: string;
}

interface OldBlob {
  claudeComments?: Record<string, OldClaudeComment[]>;
  userComments?: Record<string, string>;
  resolvedComments?: string[];
  [key: string]: unknown;
}

interface NewBlob {
  comments: Comment[];
  [key: string]: unknown;
}

export function migrateBlob(blob: Record<string, unknown>): NewBlob {
  // Already new format
  if (Array.isArray(blob.comments)) {
    return blob as unknown as NewBlob;
  }

  const old = blob as OldBlob;
  const comments: Comment[] = [];
  const resolvedSet = new Set(old.resolvedComments ?? []);

  // Migrate Claude comments
  for (const [itemId, ccs] of Object.entries(old.claudeComments ?? {})) {
    for (const cc of ccs) {
      comments.push({
        id: cc.id,
        author: 'claude',
        text: cc.comment,
        status: resolvedSet.has(`claude:${cc.id}`) ? 'resolved' : 'active',
        item: itemId,
        file: cc.file,
        line: cc.line,
        block: cc.block,
      });
    }
  }

  // Migrate user comments
  for (const [key, text] of Object.entries(old.userComments ?? {})) {
    // Reply to Claude comment: "claude:{id}"
    if (key.startsWith('claude:')) {
      const parentId = key.slice('claude:'.length);
      // Find the parent's item
      const parent = comments.find(c => c.id === parentId);
      comments.push({
        id: crypto.randomUUID(),
        author: 'user',
        text,
        status: 'active',
        parentId,
        item: parent?.item ?? 'diff',
      });
      continue;
    }

    // Document comment: "doc:{itemId}:{blockIdx}"
    if (key.startsWith('doc:')) {
      const parts = key.split(':');
      const itemId = parts[1];
      const blockIdx = parseInt(parts[2]);
      comments.push({
        id: crypto.randomUUID(),
        author: 'user',
        text,
        status: 'active',
        item: itemId,
        block: blockIdx,
        mode: 'review',
      });
      continue;
    }

    // Markdown block comment: "md::{blockIdx}"
    if (key.startsWith('md::')) {
      const blockIdx = parseInt(key.slice('md::'.length));
      comments.push({
        id: crypto.randomUUID(),
        author: 'user',
        text,
        status: 'active',
        item: 'diff',
        block: blockIdx,
        mode: 'review',
      });
      continue;
    }

    // Diff line comment: "filepath::lineIdx"
    const sepIdx = key.lastIndexOf('::');
    if (sepIdx > 0) {
      const filePath = key.substring(0, sepIdx);
      const lineIdx = parseInt(key.substring(sepIdx + 2));
      comments.push({
        id: crypto.randomUUID(),
        author: 'user',
        text,
        status: 'active',
        item: 'diff',
        file: filePath,
        line: lineIdx,
        mode: 'review',
      });
    }
  }

  // Build new blob, removing old fields
  const { claudeComments: _, userComments: __, resolvedComments: ___, ...rest } = old;
  return { ...rest, comments } as unknown as NewBlob;
}
```

**Note:** The `line` field for migrated diff comments stores the lineIdx (index into the diff's line array), not the actual file line number. This matches how the old system worked — the key was `filepath::lineIdx`. The frontend will need to resolve this to an actual line number during rendering, just as it does today.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/tom/dev/claude-review && npx vitest run server/comment-migration.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/comment-migration.ts server/comment-migration.test.ts
git commit -m "add blob migration from old comment format to unified Comment"
```

---

### Task 4: Update Session and ProjectBlob

**Files:**
- Modify: `server/store.ts` — update `ProjectBlob` type
- Modify: `server/session.ts` — replace three comment structures with `CommentStore`

- [ ] **Step 1: Update ProjectBlob type in store.ts**

In `server/store.ts`, replace the `ProjectBlob` interface:

```typescript
// server/store.ts — replace the existing ProjectBlob interface

export interface ProjectBlob {
  slug: string;
  repoPath: string;
  baseBranch: string;
  description: string;
  items: { id: string; type: 'diff' | 'document'; title: string; path?: string }[];
  comments: import('./comment-types.js').Comment[];
  analysis: Record<string, unknown> | null;
  round: number;
  reviewedFiles: string[];
  sidebarView: string;
}
```

This removes `claudeComments`, `userComments`, and `resolvedComments`, replacing them with `comments`.

- [ ] **Step 2: Rewrite Session to use CommentStore**

Replace the comment-related code in `server/session.ts`. The key changes:

- Remove `ClaudeComment` interface
- Remove `_claudeComments`, `_userComments`, `_resolvedComments` fields
- Add `_commentStore: CommentStore` field
- Update `toBlob()` and `fromBlob()` to use the new format
- Add migration call in `fromBlob()` for old blobs
- Replace comment methods with CommentStore delegation
- Remove user-state comment/resolved methods (handled by new REST routes)

The full rewrite of `session.ts`:

Import the new modules at the top:
```typescript
import { CommentStore } from './comment-store.js';
import { migrateBlob } from './comment-migration.js';
import type { Comment, CreateComment, CommentFilter } from './comment-types.js';
```

Replace the `ClaudeComment` interface and all comment-related fields with:
```typescript
private _commentStore = new CommentStore();
```

Replace `toBlob()`:
```typescript
toBlob(): ProjectBlob {
  return {
    slug: this._slug,
    repoPath: this.repoPath,
    baseBranch: this.baseBranch,
    description: this.description,
    items: this._items,
    comments: this._commentStore.toJSON(),
    analysis: this._analysis,
    round: this._round,
    reviewedFiles: Array.from(this._reviewedFiles),
    sidebarView: this._sidebarView,
  };
}
```

Replace `fromBlob()`:
```typescript
static fromBlob(blob: Record<string, unknown>, outputPath: string): Session {
  const migrated = migrateBlob(blob);
  const session = new Session({
    repoPath: migrated.repoPath as string,
    baseBranch: migrated.baseBranch as string,
    description: migrated.description as string,
    outputPath,
    slug: migrated.slug as string,
  });
  session._items = migrated.items as SessionItem[];
  session._commentStore = CommentStore.fromJSON(migrated.comments);
  session._analysis = migrated.analysis as Record<string, unknown> | null;
  session._round = migrated.round as number;
  session._reviewedFiles = new Set(migrated.reviewedFiles as string[]);
  session._sidebarView = (migrated.sidebarView as string) ?? 'flat';
  return session;
}
```

Replace the old comment methods with:
```typescript
// --- Comments ---

addComment(input: CreateComment): Comment {
  const comment = this._commentStore.add(input);
  this.persist();
  return comment;
}

addComments(itemId: string, comments: { file?: string; line?: number; block?: number; comment: string }[]): number {
  for (const c of comments) {
    this._commentStore.add({
      author: 'claude',
      text: c.comment,
      item: itemId,
      file: c.file,
      line: c.line,
      block: c.block,
    });
  }
  this.persist();
  return this._commentStore.list({ item: itemId, author: 'claude' }).length;
}

getComment(id: string): Comment | undefined {
  return this._commentStore.get(id);
}

listComments(filter?: CommentFilter): Comment[] {
  return this._commentStore.list(filter);
}

updateComment(id: string, fields: Partial<Pick<Comment, 'text' | 'status'>>): Comment | undefined {
  const result = this._commentStore.update(id, fields);
  if (result) this.persist();
  return result;
}

deleteComment(itemId: string, commentId: string): boolean {
  const result = this._commentStore.delete(commentId);
  if (result) this.persist();
  return result;
}

clearComments(itemId?: string): void {
  if (itemId) {
    for (const c of this._commentStore.list({ item: itemId })) {
      this._commentStore.delete(c.id);
    }
  } else {
    const all = this._commentStore.list();
    for (const c of all) this._commentStore.delete(c.id);
  }
  this.persist();
}
```

Remove the old user comment methods: `setUserComment`, `deleteUserComment`, `setUserResolvedComments`, `toggleUserResolvedComment`. Keep `userReviewedFiles`, `toggleUserReviewedFile`, `setUserReviewedFiles`, `userSidebarView`, `setUserSidebarView` — those are unchanged.

Remove the `get userComments()` and `get userResolvedComments()` getters.

Update `getItemData()` to return comments from the store:
```typescript
getItemData(itemId: string, commits?: string): Record<string, unknown> {
  const comments = this._commentStore.list({ item: itemId });

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
      comments,
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
    comments,
  };
}
```

- [ ] **Step 3: Verify the server compiles**

```bash
cd /Users/tom/dev/claude-review && npx tsc -p server/tsconfig.json --noEmit
```

Expected: compilation errors in `app.ts` and `mcp.ts` (they still reference old APIs). This is expected — we'll fix those in the next tasks.

- [ ] **Step 4: Commit**

```bash
git add server/store.ts server/session.ts
git commit -m "integrate CommentStore into Session, update ProjectBlob schema"
```

---

### Task 5: Server REST API for comments

**Files:**
- Modify: `server/app.ts` — replace comment/user-state routes with CRUD `/comments`

- [ ] **Step 1: Replace comment and user-state routes in app.ts**

Remove these routes from `app.ts`:
- `projectRouter.post('/comments', ...)` (the old Claude comment route)
- `projectRouter.delete('/comments', ...)` (the old delete route)
- `projectRouter.put('/user-state/comment', ...)`
- `projectRouter.put('/user-state/resolved', ...)`
- `projectRouter.post('/user-state/clear', ...)`

Remove the `userComments` field from the `/data` response (it's now in the `comments` array).

Remove the `comments` and `resolvedComments` fields from `/user-state`.

Add new CRUD routes:

```typescript
// --- Comment CRUD ---

projectRouter.get('/comments', (req, res) => {
  const session = res.locals.session;
  const filter: Record<string, string> = {};
  for (const key of ['item', 'file', 'author', 'parentId', 'mode', 'status']) {
    if (req.query[key]) filter[key] = req.query[key] as string;
  }
  const comments = session.listComments(Object.keys(filter).length > 0 ? filter : undefined);
  res.json({ comments });
});

projectRouter.post('/comments', (req, res) => {
  const session = res.locals.session;
  const { author, text, item, file, line, block, parentId, mode } = req.body;
  if (!author || !text || !item) {
    res.status(400).json({ error: 'author, text, and item are required' });
    return;
  }
  const comment = session.addComment({ author, text, item, file, line, block, parentId, mode });
  session.broadcast('comments_changed', { item, comment });
  res.json({ ok: true, comment });
});

projectRouter.patch('/comments/:id', (req, res) => {
  const session = res.locals.session;
  const { text, status } = req.body;
  const updated = session.updateComment(req.params.id, { text, status });
  if (!updated) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }
  session.broadcast('comments_changed', { item: updated.item, comment: updated });
  res.json({ ok: true, comment: updated });
});

projectRouter.delete('/comments/:id', (req, res) => {
  const session = res.locals.session;
  const comment = session.getComment(req.params.id);
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }
  session.deleteComment(comment.item, req.params.id);
  session.broadcast('comments_changed', { item: comment.item, deleted: req.params.id });
  res.json({ ok: true });
});
```

Update the `/user-state` GET route to only return reviewed files and sidebar view:

```typescript
projectRouter.get('/user-state', (_req, res) => {
  const session = res.locals.session;
  res.json({
    reviewedFiles: session.userReviewedFiles,
    sidebarView: session.userSidebarView,
  });
});
```

Update the `/user-state/clear` route to only clear reviewed files:

```typescript
projectRouter.post('/user-state/clear', (_req, res) => {
  const session = res.locals.session;
  session.setUserReviewedFiles([]);
  res.json({ ok: true });
});
```

- [ ] **Step 2: Update MCP comment tool in mcp.ts**

In `server/mcp.ts`, update the `comment` tool handler to use the new Session API. The tool interface stays the same — it still takes `repoPath`, `item`, and `comments[]`:

```typescript
async ({ repoPath, item, comments }) => {
  const lookup = requireProject(manager, repoPath);
  if ('error' in lookup) return lookup.error;
  const { found } = lookup;
  const itemId = item ?? 'diff';
  const count = found.session.addComments(itemId, comments);
  found.session.broadcast('comments_changed', { item: itemId, count: comments.length });
  return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, count }) }] };
},
```

This is actually unchanged from the current implementation since `addComments` on Session still has the same signature.

- [ ] **Step 3: Verify server compiles clean**

```bash
cd /Users/tom/dev/claude-review && npx tsc -p server/tsconfig.json --noEmit
```

Expected: PASS — no compilation errors.

- [ ] **Step 4: Commit**

```bash
git add server/app.ts server/mcp.ts
git commit -m "replace scattered comment routes with REST CRUD /comments resource"
```

---

### Task 6: Frontend comment API client

**Files:**
- Create: `frontend/src/comment-api.ts`

- [ ] **Step 1: Create the comment API client**

```typescript
// frontend/src/comment-api.ts

import type { Comment } from './comment-types';
import { baseUrl } from './api';

async function checkedJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      if (body.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return resp.json();
}

export async function fetchComments(filter?: Record<string, string>): Promise<Comment[]> {
  const params = new URLSearchParams(filter);
  const resp = await fetch(`${baseUrl()}/comments?${params}`);
  const data = await checkedJson<{ comments: Comment[] }>(resp);
  return data.comments;
}

export async function createComment(input: {
  author: 'user' | 'claude';
  text: string;
  item: string;
  file?: string;
  line?: number;
  block?: number;
  parentId?: string;
  mode?: 'review' | 'direct';
}): Promise<Comment> {
  const resp = await fetch(`${baseUrl()}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await checkedJson<{ ok: boolean; comment: Comment }>(resp);
  return data.comment;
}

export async function updateComment(id: string, fields: { text?: string; status?: string }): Promise<Comment> {
  const resp = await fetch(`${baseUrl()}/comments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await checkedJson<{ ok: boolean; comment: Comment }>(resp);
  return data.comment;
}

export async function deleteComment(id: string): Promise<void> {
  const resp = await fetch(`${baseUrl()}/comments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await checkedJson<{ ok: boolean }>(resp);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/comment-api.ts
git commit -m "add frontend REST client for /comments API"
```

---

### Task 7: Update frontend state

**Files:**
- Modify: `frontend/src/state.ts` — replace three comment structures with `Comment[]`
- Modify: `frontend/src/api.ts` — remove old comment API functions
- Modify: `frontend/src/persistence.ts` — remove comment sync logic

- [ ] **Step 1: Update state.ts**

Replace the comment-related state. Remove:
- `export const comments: Record<string, string> = {};`
- `export let claudeComments: ClaudeComment[] = [];`
- `export const resolvedComments = new Set<string>();`
- The `ClaudeComment` interface and export
- `lineIdToKey`, `getLineId`, `resetLineIds` functions and their backing maps
- `setClaudeComments` setter

Add:
```typescript
import type { Comment } from './comment-types';

export let comments: Comment[] = [];

export function setComments(c: Comment[]) {
  comments = c;
}

export function addLocalComment(c: Comment) {
  comments.push(c);
}

export function updateLocalComment(id: string, fields: Partial<Comment>) {
  const idx = comments.findIndex(c => c.id === id);
  if (idx >= 0) comments[idx] = { ...comments[idx], ...fields };
}

export function removeLocalComment(id: string) {
  comments = comments.filter(c => c.id !== id);
}
```

Keep `reviewedFiles`, `sidebarView`, and all non-comment state unchanged.

- [ ] **Step 2: Clean up api.ts**

Remove from `api.ts`:
- `deleteClaudeComment` function
- `putUserComment` function
- `putUserResolved` function
- `clearUserState` function
- The `ClaudeComment` import from state
- `claudeComments` from `DiffData` and `FileData` interfaces
- Remove `resolvedComments` from `UserState` interface and `comments` from `UserState`

Add `comments` field (the new type) to `DiffData` and `FileData`:
```typescript
import type { Comment } from './comment-types';

interface DiffData {
  mode: 'diff';
  diff: string;
  description: string;
  meta: RepoMeta;
  comments: Comment[];
}

interface FileData {
  mode: 'file';
  content: string;
  filename: string;
  filepath: string;
  markdown: boolean;
  title: string;
  comments: Comment[];
}
```

- [ ] **Step 3: Simplify persistence.ts**

Remove all comment sync logic from `persistence.ts`. The comments are now managed by the server — no local sync needed. Keep only:
- `loadState()` — fetches reviewed files and sidebar view
- `saveState()` — syncs reviewed files and sidebar view only
- `clearPersistedState()` — clears reviewed files

Remove `putUserComment`, `putUserResolved`, `clearUserState` imports and calls.
Remove `lastCommentKeys`, `lastResolvedComments` tracking.

```typescript
// frontend/src/persistence.ts

import { reviewedFiles, sidebarView } from './state';
import type { SidebarView } from './state';
import { setSidebarView } from './state';
import { fetchUserState, putUserReviewed, putUserSidebarView } from './api';

let lastReviewedFiles = new Set<string>();
let lastSidebarView = '';

export async function loadState(): Promise<void> {
  try {
    const state = await fetchUserState();

    if (state.reviewedFiles) {
      for (const path of state.reviewedFiles) {
        reviewedFiles.add(path);
      }
    }

    if (state.sidebarView && ['flat', 'grouped', 'phased'].includes(state.sidebarView)) {
      setSidebarView(state.sidebarView as SidebarView);
    }

    lastReviewedFiles = new Set(reviewedFiles);
    lastSidebarView = sidebarView;
  } catch {
    /* server unavailable — start fresh */
  }
}

export function saveState(): void {
  for (const path of reviewedFiles) {
    if (!lastReviewedFiles.has(path)) putUserReviewed(path);
  }
  for (const path of lastReviewedFiles) {
    if (!reviewedFiles.has(path)) putUserReviewed(path);
  }
  lastReviewedFiles = new Set(reviewedFiles);

  if (sidebarView !== lastSidebarView) {
    putUserSidebarView(sidebarView);
    lastSidebarView = sidebarView;
  }
}

export async function clearPersistedState(): Promise<void> {
  lastReviewedFiles = new Set();
  await fetch(`${(await import('./api')).baseUrl()}/user-state/clear`, { method: 'POST' });
}
```

- [ ] **Step 4: Verify frontend compiles**

```bash
cd /Users/tom/dev/claude-review/frontend && npx tsc --noEmit
```

Expected: compilation errors in `comments.ts`, `claude-comments.ts`, `diff.ts`, `document.ts`, `ui.ts`, `main.ts` — they still reference old types. This is expected and will be fixed in the next tasks.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/state.ts frontend/src/api.ts frontend/src/persistence.ts
git commit -m "update frontend state to use unified Comment array, remove old comment sync"
```

---

### Task 8: Refactor frontend comment rendering

**Files:**
- Modify: `frontend/src/comments.ts` — use unified Comment type
- Modify: `frontend/src/claude-comments.ts` — use unified Comment type

This is the largest frontend change. Both files need to work with `Comment[]` instead of separate structures.

- [ ] **Step 1: Refactor claude-comments.ts**

Replace the module to work with the unified `Comment` type. The key change: instead of importing `claudeComments` from state and `comments` for replies, it works with the unified `comments` array and the new API client.

```typescript
// frontend/src/claude-comments.ts

import { comments } from './state';
import type { Comment } from './comment-types';
import { escapeHtml, renderMd } from './utils';
import { updateComment as apiUpdateComment, deleteComment as apiDeleteComment, createComment as apiCreateComment } from './comment-api';
import { updateLocalComment, removeLocalComment, addLocalComment } from './state';

// --- Helpers ---

function findReplies(parentId: string): Comment[] {
  return comments.filter(c => c.parentId === parentId);
}

// --- Rendering ---

export function renderCommentHtml(comment: Comment): string {
  const isResolved = comment.status === 'resolved';
  const isDismissed = comment.status === 'dismissed';
  const replies = findReplies(comment.id);

  let inner = `<div class="claude-header">
      <span class="claude-label">${comment.author === 'claude' ? 'Claude' : 'You'}</span>`;

  if (isResolved) {
    inner += `<span class="resolve-badge">Resolved</span>
      <span class="inline-actions"><a data-unresolve-comment="${comment.id}">unresolve</a></span>`;
  } else if (!isDismissed) {
    inner += `<span class="inline-actions">`;
    if (comment.author === 'claude') {
      inner += `<a data-reply-comment="${comment.id}">reply</a>
        <a data-resolve-comment="${comment.id}">resolve</a>
        <a data-dismiss-comment="${comment.id}">dismiss</a>`;
    } else {
      inner += `<a data-edit-user-comment="${comment.id}">edit</a>
        <a class="del-action" data-delete-user-comment="${comment.id}">delete</a>`;
    }
    inner += `</span>`;
  }
  inner += `</div>`;
  inner += `<div class="claude-text">${renderMd(comment.text)}</div>`;

  // Render replies
  for (const reply of replies) {
    inner += `<div class="claude-reply" data-edit-reply="${reply.id}">
      <div class="claude-reply-header">
        <span class="reply-label">${reply.author === 'claude' ? 'Claude' : 'You'}</span>
        <span class="inline-actions">
          <a>edit</a>
          <a class="del-action" data-delete-reply="${reply.id}">delete</a>
        </span>
      </div>
      <div class="reply-text">${renderMd(reply.text)}</div>
    </div>`;
  }

  return `<div class="claude-comment${isResolved ? ' resolved' : ''}">${inner}</div>`;
}

// --- Interaction handlers ---

export function handleCommentAction(target: HTMLElement, rerender: () => void): boolean {
  // Dismiss
  const dismissEl = target.closest<HTMLElement>('[data-dismiss-comment]');
  if (dismissEl) {
    const id = dismissEl.dataset.dismissComment!;
    apiUpdateComment(id, { status: 'dismissed' });
    updateLocalComment(id, { status: 'dismissed' });
    rerender();
    return true;
  }

  // Resolve
  const resolveEl = target.closest<HTMLElement>('[data-resolve-comment]');
  if (resolveEl) {
    const id = resolveEl.dataset.resolveComment!;
    apiUpdateComment(id, { status: 'resolved' });
    updateLocalComment(id, { status: 'resolved' });
    rerender();
    return true;
  }

  // Unresolve
  const unresolveEl = target.closest<HTMLElement>('[data-unresolve-comment]');
  if (unresolveEl) {
    const id = unresolveEl.dataset.unresolveComment!;
    apiUpdateComment(id, { status: 'active' });
    updateLocalComment(id, { status: 'active' });
    rerender();
    return true;
  }

  // Reply to comment
  const replyEl = target.closest<HTMLElement>('[data-reply-comment]');
  if (replyEl) {
    const id = replyEl.dataset.replyComment!;
    const comment = comments.find(c => c.id === id);
    if (comment) openReplyTextarea(comment, rerender);
    return true;
  }

  // Edit reply
  const editReplyEl = target.closest<HTMLElement>('[data-edit-reply]');
  if (editReplyEl) {
    const id = editReplyEl.dataset.editReply!;
    const reply = comments.find(c => c.id === id);
    if (reply) openEditTextarea(reply, rerender);
    return true;
  }

  // Delete reply
  const deleteReplyEl = target.closest<HTMLElement>('[data-delete-reply]');
  if (deleteReplyEl) {
    const id = deleteReplyEl.dataset.deleteReply!;
    apiDeleteComment(id);
    removeLocalComment(id);
    rerender();
    return true;
  }

  // Delete user comment
  const deleteUserEl = target.closest<HTMLElement>('[data-delete-user-comment]');
  if (deleteUserEl) {
    const id = deleteUserEl.dataset.deleteUserComment!;
    apiDeleteComment(id);
    removeLocalComment(id);
    rerender();
    return true;
  }

  // Edit user comment
  const editUserEl = target.closest<HTMLElement>('[data-edit-user-comment]');
  if (editUserEl) {
    const id = editUserEl.dataset.editUserComment!;
    const comment = comments.find(c => c.id === id);
    if (comment) openEditTextarea(comment, rerender);
    return true;
  }

  return false;
}

// --- Reply textarea ---

function openReplyTextarea(parent: Comment, rerender: () => void): void {
  const commentEl = document.querySelector(`[data-reply-comment="${parent.id}"]`)?.closest('.claude-comment');
  if (!commentEl) return;

  const existingTextarea = commentEl.querySelector('.reply-textarea-wrap');
  if (existingTextarea) existingTextarea.remove();

  const wrap = document.createElement('div');
  wrap.className = 'reply-textarea-wrap';
  wrap.innerHTML = `
    <textarea class="reply-input" style="width:100%;min-height:36px;padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;resize:vertical;outline:none;font-family:inherit;" placeholder="Reply..."></textarea>
    <div class="comment-actions" style="margin-top:4px">
      <button class="cancel-btn" data-action="cancel-reply">Cancel</button>
      <button class="save-btn" data-action="save-reply">Save</button>
    </div>
  `;

  commentEl.appendChild(wrap);
  const textarea = wrap.querySelector('textarea')!;
  textarea.focus();

  const save = async () => {
    const trimmed = textarea.value.trim();
    if (!trimmed) return;
    const reply = await apiCreateComment({
      author: 'user',
      text: trimmed,
      item: parent.item,
      parentId: parent.id,
    });
    addLocalComment(reply);
    rerender();
  };

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { wrap.remove(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Enter' && e.metaKey) { save(); e.preventDefault(); e.stopPropagation(); }
  });
  textarea.addEventListener('click', (e) => e.stopPropagation());
  wrap.querySelector('[data-action="cancel-reply"]')!.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
  wrap.querySelector('[data-action="save-reply"]')!.addEventListener('click', (e) => { e.stopPropagation(); save(); });
}

function openEditTextarea(comment: Comment, rerender: () => void): void {
  const el = document.querySelector(`[data-edit-reply="${comment.id}"], [data-edit-user-comment="${comment.id}"]`)?.closest('.claude-comment, .claude-reply');
  if (!el) return;

  const existingTextarea = el.querySelector('.reply-textarea-wrap');
  if (existingTextarea) existingTextarea.remove();

  const wrap = document.createElement('div');
  wrap.className = 'reply-textarea-wrap';
  wrap.innerHTML = `
    <textarea class="reply-input" style="width:100%;min-height:36px;padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;resize:vertical;outline:none;font-family:inherit;">${escapeHtml(comment.text)}</textarea>
    <div class="comment-actions" style="margin-top:4px">
      <button class="cancel-btn" data-action="cancel-edit">Cancel</button>
      <button class="save-btn" data-action="save-edit">Save</button>
    </div>
  `;

  el.appendChild(wrap);
  const textarea = wrap.querySelector('textarea')!;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const save = async () => {
    const trimmed = textarea.value.trim();
    if (!trimmed) return;
    await apiUpdateComment(comment.id, { text: trimmed });
    updateLocalComment(comment.id, { text: trimmed });
    rerender();
  };

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { wrap.remove(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Enter' && e.metaKey) { save(); e.preventDefault(); e.stopPropagation(); }
  });
  textarea.addEventListener('click', (e) => e.stopPropagation());
  wrap.querySelector('[data-action="cancel-edit"]')!.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
  wrap.querySelector('[data-action="save-edit"]')!.addEventListener('click', (e) => { e.stopPropagation(); save(); });
}
```

- [ ] **Step 2: Refactor comments.ts**

Update `comments.ts` to work with the new `Comment` type and API. The main changes:
- `toggleComment` creates a comment via the API instead of storing locally
- `saveComment` calls `createComment` or `updateComment` API
- `formatAllComments` reads from the unified `comments` array
- Remove `lineIdToKey` usage — comments have direct location info

```typescript
// frontend/src/comments.ts

import { comments, files, activeFileIdx, activeItemId } from './state';
import { addLocalComment, updateLocalComment, removeLocalComment } from './state';
import type { Comment } from './comment-types';
import { escapeHtml } from './utils';
import { renderDiff } from './diff';
import { renderFileList } from './ui';
import { createComment as apiCreateComment, updateComment as apiUpdateComment, deleteComment as apiDeleteComment } from './comment-api';

export function toggleComment(file: string, lineIdx: number, lineNum: number | null): void {
  // Check if there's already a user review comment at this location
  const existing = comments.find(c =>
    c.author === 'user' && c.mode === 'review' && c.item === 'diff' &&
    c.file === file && c.line === lineIdx
  );
  if (existing) {
    editComment(existing);
    return;
  }

  // Check if textarea is already open for this location
  const locationId = `comment-form-${file}-${lineIdx}`;
  if (document.getElementById(locationId)) {
    document.getElementById(locationId)?.querySelector('textarea')?.focus();
    return;
  }

  // Find the line row in the DOM
  const rows = document.querySelectorAll<HTMLElement>(`tr[data-file="${CSS.escape(file)}"][data-line-idx="${lineIdx}"]`);
  const lineRow = rows[0];
  if (!lineRow) return;

  const commentRow = document.createElement('tr');
  commentRow.className = 'comment-row';
  commentRow.id = locationId;
  commentRow.innerHTML = `
    <td colspan="3">
      <div class="comment-box">
        <textarea placeholder="Leave a comment..." autofocus></textarea>
        <div class="comment-actions">
          <button class="cancel-btn" data-action="cancel">Cancel</button>
          <button class="save-btn" data-action="save">Save</button>
        </div>
      </div>
    </td>
  `;

  const textarea = commentRow.querySelector('textarea')!;
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { commentRow.remove(); e.preventDefault(); }
    else if (e.key === 'Enter' && e.metaKey) { saveNewComment(file, lineIdx); e.preventDefault(); }
  });
  commentRow.querySelector('[data-action="cancel"]')!.addEventListener('click', () => commentRow.remove());
  commentRow.querySelector('[data-action="save"]')!.addEventListener('click', () => saveNewComment(file, lineIdx));

  lineRow.after(commentRow);
  textarea.focus();
}

async function saveNewComment(file: string, lineIdx: number): Promise<void> {
  const locationId = `comment-form-${file}-${lineIdx}`;
  const row = document.getElementById(locationId);
  if (!row) return;
  const text = row.querySelector('textarea')?.value?.trim();
  if (!text) { row.remove(); return; }

  const comment = await apiCreateComment({
    author: 'user',
    text,
    item: 'diff',
    file,
    line: lineIdx,
    mode: 'review',
  });
  addLocalComment(comment);
  renderDiff(activeFileIdx);
  renderFileList();
}

function editComment(comment: Comment): void {
  // Implementation follows same pattern as current editComment but
  // uses apiUpdateComment and updateLocalComment
  // (Full implementation provided — renders textarea with current text,
  // save calls apiUpdateComment, delete calls apiDeleteComment)
}

export function jumpToComment(direction: 'next' | 'prev'): void {
  const container = document.getElementById('diff-container')!;
  const rows = Array.from(container.querySelectorAll('tr.comment-row, tr.claude-comment-row'));
  if (rows.length === 0) return;

  const containerRect = container.getBoundingClientRect();

  if (direction === 'next') {
    const next = rows.find((r) => r.getBoundingClientRect().top > containerRect.top + 10);
    if (next) next.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else rows[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else {
    const prev = rows.reverse().find((r) => r.getBoundingClientRect().top < containerRect.top - 10);
    if (prev) prev.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else rows[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

export function formatAllComments(): string {
  let output = '';

  // Diff line comments (user, mode=review, root comments only)
  const diffUserComments = comments.filter(c =>
    c.author === 'user' && c.mode === 'review' && c.item === 'diff' && c.file && !c.parentId
  );
  const byFile: Record<string, Comment[]> = {};
  for (const c of diffUserComments) {
    if (!byFile[c.file!]) byFile[c.file!] = [];
    byFile[c.file!].push(c);
  }
  for (const [filePath, fileComments] of Object.entries(byFile)) {
    output += `## ${filePath}\n\n`;
    for (const c of fileComments.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
      const file = files.find(f => f.path === filePath);
      const line = file?.lines[c.line ?? 0];
      const lineNum = line?.newLine ?? line?.oldLine ?? '?';
      const prefix = line?.type === 'add' ? '+' : line?.type === 'del' ? '-' : ' ';
      output += `Line ${lineNum}: \`${prefix}${(line?.content ?? '').trim()}\`\n`;
      output += `> ${c.text}\n\n`;
    }
  }

  // Claude comment interactions (replies and resolved)
  const claudeComments = comments.filter(c => c.author === 'claude' && c.item === 'diff' && !c.parentId);
  const interactionsByFile: Record<string, { line: number; comment: string; reply?: string; resolved: boolean }[]> = {};
  for (const cc of claudeComments) {
    const replies = comments.filter(c => c.parentId === cc.id);
    const reply = replies.find(r => r.author === 'user');
    if (!reply && cc.status !== 'resolved') continue;
    const filePath = cc.file ?? 'unknown';
    if (!interactionsByFile[filePath]) interactionsByFile[filePath] = [];
    interactionsByFile[filePath].push({
      line: cc.line ?? 0,
      comment: cc.text,
      reply: reply?.text,
      resolved: cc.status === 'resolved',
    });
  }
  for (const [filePath, interactions] of Object.entries(interactionsByFile)) {
    output += `## ${filePath}\n\n`;
    for (const c of interactions.sort((a, b) => a.line - b.line)) {
      output += `**Claude:** ${c.comment}\n`;
      if (c.reply) output += `**Reply:** ${c.reply}\n`;
      else if (c.resolved) output += `**Status:** Resolved\n`;
      output += '\n';
    }
  }

  // Document comments (same pattern for each non-diff item)
  for (const item of (await import('./state')).sessionItems) {
    if (item.id === 'diff') continue;
    const docUserComments = comments.filter(c =>
      c.author === 'user' && c.mode === 'review' && c.item === item.id && !c.parentId
    );
    if (docUserComments.length === 0) continue;
    output += `## ${item.title}\n\n`;
    for (const c of docUserComments.sort((a, b) => (a.block ?? 0) - (b.block ?? 0))) {
      output += `> ${c.text}\n\n`;
    }

    // Doc Claude interactions
    const docClaude = comments.filter(c => c.author === 'claude' && c.item === item.id && !c.parentId);
    for (const cc of docClaude) {
      const replies = comments.filter(c => c.parentId === cc.id);
      const reply = replies.find(r => r.author === 'user');
      if (!reply && cc.status !== 'resolved') continue;
      output += `**Claude:** ${cc.text}\n`;
      if (reply) output += `**Reply:** ${reply.text}\n`;
      else if (cc.status === 'resolved') output += `**Status:** Resolved\n`;
      output += '\n';
    }
  }

  return output || 'No comments (LGTM).';
}
```

**Note:** The `editComment` function body follows the same pattern as the current one but works with `Comment` objects and the API. The implementer should port the existing logic from the current `editComment` in `comments.ts`, replacing `comments[lineKey]` reads/writes with API calls and local state updates.

**Note:** The `formatAllComments` function above uses a synchronous `import` of `sessionItems` — the implementer should restructure this to import `sessionItems` from state at the top of the file, since the dynamic import pattern won't work as shown. This is a known simplification in the plan.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/comments.ts frontend/src/claude-comments.ts
git commit -m "refactor comment rendering to use unified Comment type and REST API"
```

---

### Task 9: Update diff rendering

**Files:**
- Modify: `frontend/src/diff.ts` — use unified comments, add data attributes for comment targeting, add comments to whole-file view

- [ ] **Step 1: Update diff.ts imports and comment rendering**

Key changes to `diff.ts`:

1. Replace `claudeComments` and `comments` imports with the unified `comments` array
2. Replace `getLineId`/`lineIdToKey` with data attributes on line rows (`data-file`, `data-line-idx`)
3. Update `renderDiffLineHtml` to find comments by file + line from the unified array
4. Update `showWholeFile` to render both Claude and user comments
5. Update click handlers to use new `toggleComment` signature

Replace imports:
```typescript
import { files, activeFileIdx, comments, analysis, setActiveFileIdx, setWholeFileView, type DiffFile } from './state';
import type { Comment } from './comment-types';
```

In `renderDiffLineHtml`, replace the line ID system with data attributes:
```typescript
// Instead of:
//   id="line-${lineId}"
// Use:
//   id="line-${file.path}-${lineIdx}" data-file="${file.path}" data-line-idx="${lineIdx}"
```

Replace Claude comment lookup:
```typescript
// Instead of filtering claudeComments by file/line:
const lineComments = comments.filter(c =>
  c.item === 'diff' && c.file === file.path && !c.parentId && c.status !== 'dismissed' && (
    (c.author === 'claude' && ((c.side || 'new') === 'new' ? c.line === line.newLine : c.line === line.oldLine)) ||
    (c.author === 'user' && c.mode === 'review' && c.line === lineIdx)
  )
);
```

For whole-file view, add user review comments alongside Claude comments:
```typescript
// In showWholeFile, after rendering Claude comments for a line,
// also render user review comments for that line
const userCommentsForLine = comments.filter(c =>
  c.author === 'user' && c.mode === 'review' && c.item === 'diff' &&
  c.file === file.path && c.status === 'active'
);
```

Update the click handler to pass file path and line index:
```typescript
// In handleDiffContainerClick, update line click handling:
const lineRow = target.closest<HTMLElement>('tr[data-file][data-line-idx]');
if (lineRow) {
  toggleComment(lineRow.dataset.file!, parseInt(lineRow.dataset.lineIdx!), null);
  return;
}
```

- [ ] **Step 2: Verify frontend compiles**

```bash
cd /Users/tom/dev/claude-review/frontend && npx tsc --noEmit
```

Expected: may still have errors in `document.ts`, `ui.ts`, `main.ts`. Fix those in next tasks.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/diff.ts
git commit -m "update diff rendering for unified comments, add comments to whole-file view"
```

---

### Task 10: Update document rendering

**Files:**
- Modify: `frontend/src/document.ts` — use unified Comment type

- [ ] **Step 1: Refactor document.ts**

Key changes:
- Replace `comments[mdKey(blockIdx)]` lookups with filtering the unified `comments` array by item + block
- Replace `claudeComments` filtering with unified filter
- Use API client for create/update/delete instead of local state mutation
- Remove `mdKey` function — comments are identified by item + block, not string keys

Replace imports:
```typescript
import { comments, activeItemId, mdMeta, setMdMeta, type MdMeta } from './state';
import { addLocalComment, updateLocalComment, removeLocalComment } from './state';
import type { Comment } from './comment-types';
import { escapeHtml, renderMd } from './utils';
import { createComment as apiCreateComment, updateComment as apiUpdateComment, deleteComment as apiDeleteComment } from './comment-api';
import { renderCommentHtml, handleCommentAction } from './claude-comments';
```

For block comment lookups:
```typescript
// Instead of: comments[mdKey(blockIdx)]
// Use:
const blockComments = comments.filter(c =>
  c.item === activeItemId && c.block === blockIdx && !c.parentId && c.status !== 'dismissed'
);
```

For saving new comments:
```typescript
// Instead of: comments[key] = text; saveState();
// Use:
const comment = await apiCreateComment({
  author: 'user',
  text,
  item: activeItemId,
  block: blockIdx,
  mode: 'review',
});
addLocalComment(comment);
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/document.ts
git commit -m "update document rendering for unified comments"
```

---

### Task 11: Update UI, main, and SSE

**Files:**
- Modify: `frontend/src/ui.ts` — update tab badges, submit flow
- Modify: `frontend/src/main.ts` — load comments from API, update SSE handlers

- [ ] **Step 1: Update ui.ts**

Update tab badge counting:
```typescript
// Instead of counting from comments map and claudeComments array:
const itemComments = comments.filter(c => c.item === item.id && !c.parentId && c.status !== 'dismissed');
const claudeCount = itemComments.filter(c => c.author === 'claude').length;
const userCount = itemComments.filter(c => c.author === 'user').length;
```

Update `setupDiffView` and `setupFileView` — remove `setClaudeComments` calls. Comments are now loaded separately from the `/comments` API.

Update `handleSubmitReview` — instead of clearing the local `comments` map, the review comments stay on the server (they're already persisted). The submit just formats and sends.

- [ ] **Step 2: Update main.ts**

Add comment loading on init:
```typescript
import { fetchComments } from './comment-api';
import { setComments } from './state';

// In init(), after loadItems():
const allComments = await fetchComments();
setComments(allComments);
```

Update SSE handler — on `comments_changed`, refetch comments:
```typescript
es.addEventListener('comments_changed', async () => {
  const allComments = await fetchComments();
  setComments(allComments);
  switchToItem(activeItemId);
  showToast('Comments updated', 2000);
});
```

- [ ] **Step 3: Verify everything compiles**

```bash
cd /Users/tom/dev/claude-review/frontend && npx tsc --noEmit
```

Expected: PASS — all compilation errors resolved.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/ui.ts frontend/src/main.ts
git commit -m "update UI and SSE to use unified comments API"
```

---

### Task 12: End-to-end verification

- [ ] **Step 1: Run all tests**

```bash
cd /Users/tom/dev/claude-review && npx vitest run
cd /Users/tom/dev/claude-review/frontend && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 2: Build check**

```bash
cd /Users/tom/dev/claude-review && npm run build
```

Expected: PASS — server and frontend both compile.

- [ ] **Step 3: Manual smoke test**

Start the dev server:
```bash
cd /Users/tom/dev/claude-review && npm run dev:all
```

Verify in browser at http://localhost:9900/project/claude-review/:
1. Existing persisted comments appear (migration worked)
2. Can add a user comment on a diff line — saves via API
3. Claude comments render with reply/resolve/dismiss
4. Can reply to a Claude comment — reply appears
5. Resolve/dismiss changes comment status
6. Whole-file view shows comments
7. Tab badges show correct counts
8. Submit review formats comments correctly
9. SSE updates work when Claude adds comments via MCP

- [ ] **Step 4: Commit any fixes**

If the smoke test reveals issues, fix them and commit.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "unified comment model: end-to-end verification complete"
```
