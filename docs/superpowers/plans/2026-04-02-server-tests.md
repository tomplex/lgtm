# Comprehensive Server Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comprehensive test coverage for all server modules: store, git-ops, Session, SessionManager, and Express routes.

**Architecture:** Real dependencies throughout — temp git repos, temp SQLite databases, supertest for HTTP. No mocks. A shared test fixture creates a git repo with known state. The store module gets a small refactor to accept a configurable DB path.

**Tech Stack:** vitest, supertest, better-sqlite3, git (real repos in temp dirs)

---

## File Structure

```
server/
├── __tests__/
│   ├── helpers/
│   │   └── git-fixture.ts         # Shared temp git repo setup/teardown
│   ├── parse-analysis.test.ts     # (existing, already converted to vitest)
│   ├── store.test.ts              # SQLite CRUD tests
│   ├── git-ops.test.ts            # Git operations against real temp repo
│   ├── session.test.ts            # Session class unit tests
│   ├── session-manager.test.ts    # SessionManager lifecycle tests
│   └── routes.test.ts             # Express route integration tests via supertest
├── comment-store.test.ts          # (existing)
├── comment-migration.test.ts      # (existing)
├── store.ts                       # Modified: configurable DB path
└── ...
```

---

### Task 1: Make store.ts DB path configurable

**Files:**
- Modify: `server/store.ts`

The store currently hardcodes `~/.lgtm/data.db`. Tests need their own temp database. Add an `initStore(dbPath?)` function and support `LGTM_DB_PATH` env var.

- [ ] **Step 1: Refactor store.ts to support configurable DB path**

Replace the current DB initialization in `server/store.ts` with:

```ts
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
  comments: import('./comment-types.js').Comment[];
  analysis: Record<string, unknown> | null;
  rounds: Record<string, number>;
  reviewedFiles: string[];
  sidebarView: string;
}

let _db: Database.Database | null = null;

function defaultDbPath(): string {
  return process.env.LGTM_DB_PATH || join(homedir(), '.lgtm', 'data.db');
}

export function initStore(dbPath?: string): void {
  if (_db) _db.close();
  const path = dbPath ?? defaultDbPath();
  mkdirSync(dirname(path), { recursive: true });
  _db = new Database(path);
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      slug TEXT PRIMARY KEY,
      data TEXT NOT NULL
    )
  `);
}

export function closeStore(): void {
  if (_db) { _db.close(); _db = null; }
}

function db(): Database.Database {
  if (!_db) initStore();
  return _db!;
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

Key changes: added `initStore(dbPath?)`, `closeStore()`, `defaultDbPath()` using env var fallback. Existing behavior unchanged when called without arguments.

- [ ] **Step 2: Verify existing server tests still pass**

Run: `npm run test:server`

Expected: All 29 tests pass (the store refactor doesn't change behavior for existing callers).

- [ ] **Step 3: Verify server builds**

Run: `npm run build:server`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add server/store.ts
git commit -m "store: make DB path configurable for testing"
```

---

### Task 2: Shared git fixture

**Files:**
- Create: `server/__tests__/helpers/git-fixture.ts`

A helper that creates a temp git repo with a known state for tests.

- [ ] **Step 1: Create the git fixture helper**

```ts
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

export interface GitFixture {
  repoPath: string;
  mainBranch: string;
  featureBranch: string;
  /** SHAs of commits on the feature branch (oldest first) */
  featureCommits: string[];
  cleanup: () => void;
}

function git(repoPath: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repoPath, encoding: 'utf-8' }).trim();
}

/**
 * Creates a temp git repo with:
 * - main branch with 2 commits (README.md, src/app.ts, package.json)
 * - feature branch with 2 commits (modifies src/app.ts, adds src/utils.ts)
 * - feature branch checked out
 */
export function createGitFixture(): GitFixture {
  const repoPath = mkdtempSync(join(tmpdir(), 'lgtm-test-'));

  // Init and configure
  git(repoPath, 'init', '-b', 'main');
  git(repoPath, 'config', 'user.name', 'Test User');
  git(repoPath, 'config', 'user.email', 'test@example.com');

  // Main branch — commit 1
  writeFileSync(join(repoPath, 'README.md'), '# Test Project\n\nA test repo.\n');
  mkdirSync(join(repoPath, 'src'));
  writeFileSync(join(repoPath, 'src', 'app.ts'), [
    'import { hello } from "./utils";',
    '',
    'function main() {',
    '  console.log(hello());',
    '}',
    '',
    'main();',
    '',
  ].join('\n'));
  writeFileSync(join(repoPath, 'package.json'), '{ "name": "test-project" }\n');
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-m', 'initial commit');

  // Main branch — commit 2
  writeFileSync(join(repoPath, 'README.md'), '# Test Project\n\nA test repo for LGTM.\n');
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-m', 'update readme');

  // Feature branch
  git(repoPath, 'checkout', '-b', 'feature');

  // Feature commit 1 — modify app.ts
  writeFileSync(join(repoPath, 'src', 'app.ts'), [
    'import { hello, goodbye } from "./utils";',
    '',
    'function main() {',
    '  console.log(hello());',
    '  console.log(goodbye());',
    '}',
    '',
    'main();',
    '',
  ].join('\n'));
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-m', 'add goodbye call');
  const sha1 = git(repoPath, 'rev-parse', 'HEAD');

  // Feature commit 2 — add utils.ts
  writeFileSync(join(repoPath, 'src', 'utils.ts'), [
    'export function hello(): string {',
    '  return "hello";',
    '}',
    '',
    'export function goodbye(): string {',
    '  return "goodbye";',
    '}',
    '',
  ].join('\n'));
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-m', 'add utils module');
  const sha2 = git(repoPath, 'rev-parse', 'HEAD');

  return {
    repoPath,
    mainBranch: 'main',
    featureBranch: 'feature',
    featureCommits: [sha1, sha2],
    cleanup: () => rmSync(repoPath, { recursive: true, force: true }),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/__tests__/helpers/git-fixture.ts
git commit -m "test helpers: shared git fixture for server tests"
```

---

### Task 3: Install supertest

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install supertest**

Run: `npm install -D supertest @types/supertest`

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "add supertest for route testing"
```

---

### Task 4: Store tests

**Files:**
- Create: `server/__tests__/store.test.ts`

- [ ] **Step 1: Write store tests**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initStore, closeStore, storeGet, storePut, storeDelete, storeList, type ProjectBlob } from '../store.js';

function makeBlob(slug: string, overrides?: Partial<ProjectBlob>): ProjectBlob {
  return {
    slug,
    repoPath: `/tmp/test-${slug}`,
    baseBranch: 'main',
    description: '',
    items: [{ id: 'diff', type: 'diff', title: 'Code Changes' }],
    comments: [],
    analysis: null,
    rounds: {},
    reviewedFiles: [],
    sidebarView: 'flat',
    ...overrides,
  };
}

describe('store', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-store-test-'));
    initStore(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeStore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('storeGet returns null for missing slug', () => {
    expect(storeGet('nonexistent')).toBeNull();
  });

  it('storePut + storeGet round-trips a blob', () => {
    const blob = makeBlob('test-project');
    storePut('test-project', blob);
    const retrieved = storeGet('test-project');
    expect(retrieved).toEqual(blob);
  });

  it('storePut upserts — overwrites existing entry', () => {
    const blob1 = makeBlob('upsert-test', { description: 'first' });
    storePut('upsert-test', blob1);
    const blob2 = makeBlob('upsert-test', { description: 'second' });
    storePut('upsert-test', blob2);
    const retrieved = storeGet('upsert-test');
    expect(retrieved?.description).toBe('second');
  });

  it('storeDelete removes entry', () => {
    const blob = makeBlob('delete-me');
    storePut('delete-me', blob);
    expect(storeGet('delete-me')).not.toBeNull();
    storeDelete('delete-me');
    expect(storeGet('delete-me')).toBeNull();
  });

  it('storeList returns all entries', () => {
    // Clean slate — delete known keys from prior tests
    storeDelete('test-project');
    storeDelete('upsert-test');

    storePut('list-a', makeBlob('list-a'));
    storePut('list-b', makeBlob('list-b'));
    const list = storeList();
    const slugs = list.map(b => b.slug);
    expect(slugs).toContain('list-a');
    expect(slugs).toContain('list-b');
  });

  it('preserves complex blob data through JSON round-trip', () => {
    const blob = makeBlob('complex', {
      comments: [
        { id: 'c1', author: 'claude', text: 'test', status: 'active', item: 'diff', file: 'app.ts', line: 10 },
      ],
      analysis: { files: { 'app.ts': { priority: 'critical' } } },
      rounds: { diff: 2 },
      reviewedFiles: ['app.ts', 'utils.ts'],
      sidebarView: 'grouped',
    });
    storePut('complex', blob);
    const retrieved = storeGet('complex');
    expect(retrieved?.comments).toHaveLength(1);
    expect(retrieved?.comments[0].id).toBe('c1');
    expect(retrieved?.analysis).toEqual({ files: { 'app.ts': { priority: 'critical' } } });
    expect(retrieved?.rounds).toEqual({ diff: 2 });
    expect(retrieved?.reviewedFiles).toEqual(['app.ts', 'utils.ts']);
    expect(retrieved?.sidebarView).toBe('grouped');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test:server`

Expected: Store tests pass alongside existing tests.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/store.test.ts
git commit -m "tests: store CRUD and JSON round-trip"
```

---

### Task 5: Git-ops tests

**Files:**
- Create: `server/__tests__/git-ops.test.ts`

- [ ] **Step 1: Write git-ops tests**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import {
  gitRun,
  detectBaseBranch,
  getBranchDiff,
  getSelectedCommitsDiff,
  getBranchCommits,
  getRepoMeta,
  getFileLines,
} from '../git-ops.js';

describe('git-ops', () => {
  let fixture: GitFixture;

  beforeAll(() => {
    fixture = createGitFixture();
  });

  afterAll(() => {
    fixture.cleanup();
  });

  describe('gitRun', () => {
    it('returns stdout from git command', () => {
      const result = gitRun(fixture.repoPath, 'rev-parse', '--abbrev-ref', 'HEAD');
      expect(result).toBe('feature');
    });

    it('throws on invalid repo path', () => {
      expect(() => gitRun('/tmp/nonexistent-repo', 'status')).toThrow();
    });
  });

  describe('detectBaseBranch', () => {
    it('returns main when main branch exists', () => {
      expect(detectBaseBranch(fixture.repoPath)).toBe('main');
    });
  });

  describe('getBranchDiff', () => {
    it('returns unified diff with additions and deletions', () => {
      const diff = getBranchDiff(fixture.repoPath, 'main');
      expect(diff).toContain('diff --git');
      expect(diff).toContain('src/app.ts');
      expect(diff).toContain('src/utils.ts');
      // Should contain the goodbye addition
      expect(diff).toContain('+import { hello, goodbye }');
    });

    it('returns empty string when no changes', () => {
      const diff = getBranchDiff(fixture.repoPath, 'feature');
      // Comparing branch to itself — merge-base is HEAD, no diff files
      expect(diff).toBe('');
    });
  });

  describe('getSelectedCommitsDiff', () => {
    it('returns diff for specific commit SHAs', () => {
      const diff = getSelectedCommitsDiff(fixture.repoPath, [fixture.featureCommits[0]]);
      expect(diff).toContain('src/app.ts');
      expect(diff).toContain('goodbye');
      // Should NOT contain utils.ts (that's in the second commit)
      expect(diff).not.toContain('src/utils.ts');
    });

    it('returns diff for multiple commits', () => {
      const diff = getSelectedCommitsDiff(fixture.repoPath, fixture.featureCommits);
      expect(diff).toContain('src/app.ts');
      expect(diff).toContain('src/utils.ts');
    });
  });

  describe('getBranchCommits', () => {
    it('returns commits on feature branch', () => {
      const commits = getBranchCommits(fixture.repoPath, 'main');
      expect(commits).toHaveLength(2);
      expect(commits[0].message).toBe('add utils module');
      expect(commits[1].message).toBe('add goodbye call');
      expect(commits[0].author).toBe('Test User');
      expect(commits[0].sha).toHaveLength(40);
      expect(commits[0].date).toBeTruthy();
    });
  });

  describe('getRepoMeta', () => {
    it('returns branch and repo info', () => {
      const meta = getRepoMeta(fixture.repoPath, 'main');
      expect(meta.branch).toBe('feature');
      expect(meta.baseBranch).toBe('main');
      expect(meta.repoName).toBeTruthy();
      expect(meta.repoPath).toBe(fixture.repoPath);
    });
  });

  describe('getFileLines', () => {
    it('reads lines going down from a position', () => {
      const lines = getFileLines(fixture.repoPath, 'src/app.ts', 0, 3, 'down');
      expect(lines).toHaveLength(3);
      expect(lines[0].num).toBe(1);
      expect(lines[0].content).toContain('import');
      expect(lines[2].num).toBe(3);
    });

    it('reads lines going up from a position', () => {
      const lines = getFileLines(fixture.repoPath, 'src/app.ts', 5, 3, 'up');
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[lines.length - 1].num).toBeLessThanOrEqual(5);
    });

    it('returns empty array for nonexistent file', () => {
      const lines = getFileLines(fixture.repoPath, 'nonexistent.ts', 0, 5);
      expect(lines).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test:server`

Expected: Git-ops tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/git-ops.test.ts
git commit -m "tests: git-ops against real temp repo"
```

---

### Task 6: Session tests

**Files:**
- Create: `server/__tests__/session.test.ts`

- [ ] **Step 1: Write Session tests**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import { initStore, closeStore, storeGet } from '../store.js';
import { Session, type SSEClient } from '../session.js';

describe('Session', () => {
  let fixture: GitFixture;
  let tmpDir: string;
  let outputPath: string;

  beforeAll(() => {
    fixture = createGitFixture();
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-session-test-'));
    initStore(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeStore();
    fixture.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeSession(slug = 'test-session'): Session {
    outputPath = join(tmpDir, `${slug}.md`);
    return new Session({
      repoPath: fixture.repoPath,
      baseBranch: 'main',
      description: 'Test review',
      outputPath,
      slug,
    });
  }

  describe('comments', () => {
    it('addComment returns comment with generated ID and active status', () => {
      const session = makeSession('comment-test');
      const comment = session.addComment({
        author: 'user',
        text: 'Looks wrong',
        item: 'diff',
        file: 'src/app.ts',
        line: 5,
      });
      expect(comment.id).toBeTruthy();
      expect(comment.status).toBe('active');
      expect(comment.author).toBe('user');
      expect(comment.text).toBe('Looks wrong');
    });

    it('updateComment changes text and status', () => {
      const session = makeSession('comment-update');
      const comment = session.addComment({ author: 'claude', text: 'Fix this', item: 'diff' });
      const updated = session.updateComment(comment.id, { status: 'resolved' });
      expect(updated?.status).toBe('resolved');
      const updated2 = session.updateComment(comment.id, { text: 'Actually fine' });
      expect(updated2?.text).toBe('Actually fine');
    });

    it('deleteComment removes comment', () => {
      const session = makeSession('comment-delete');
      const comment = session.addComment({ author: 'user', text: 'Remove me', item: 'diff' });
      expect(session.listComments()).toHaveLength(1);
      session.deleteComment('diff', comment.id);
      expect(session.listComments()).toHaveLength(0);
    });

    it('listComments filters by item, author, file', () => {
      const session = makeSession('comment-filter');
      session.addComment({ author: 'user', text: 'User on diff', item: 'diff', file: 'a.ts' });
      session.addComment({ author: 'claude', text: 'Claude on diff', item: 'diff', file: 'b.ts' });
      session.addComment({ author: 'user', text: 'User on doc', item: 'doc1' });

      expect(session.listComments({ item: 'diff' })).toHaveLength(2);
      expect(session.listComments({ author: 'claude' })).toHaveLength(1);
      expect(session.listComments({ item: 'diff', file: 'a.ts' })).toHaveLength(1);
    });

    it('addComments batch-adds Claude comments', () => {
      const session = makeSession('comment-batch');
      const count = session.addComments('diff', [
        { file: 'a.ts', line: 1, comment: 'First' },
        { file: 'b.ts', line: 2, comment: 'Second' },
      ]);
      expect(count).toBe(2);
      const all = session.listComments({ author: 'claude' });
      expect(all).toHaveLength(2);
    });
  });

  describe('items', () => {
    it('starts with diff item', () => {
      const session = makeSession('items-default');
      expect(session.items).toHaveLength(1);
      expect(session.items[0].id).toBe('diff');
    });

    it('addItem adds a document item', () => {
      const session = makeSession('items-add');
      session.addItem('design-doc', 'Design Doc', join(fixture.repoPath, 'README.md'));
      expect(session.items).toHaveLength(2);
      expect(session.items[1].id).toBe('design-doc');
    });

    it('removeItem removes item and its comments', () => {
      const session = makeSession('items-remove');
      session.addItem('temp-doc', 'Temp', join(fixture.repoPath, 'README.md'));
      session.addComment({ author: 'user', text: 'On temp doc', item: 'temp-doc', block: 0 });
      expect(session.listComments({ item: 'temp-doc' })).toHaveLength(1);
      const removed = session.removeItem('temp-doc');
      expect(removed).toBe(true);
      expect(session.items).toHaveLength(1);
      expect(session.listComments({ item: 'temp-doc' })).toHaveLength(0);
    });

    it('cannot remove diff item', () => {
      const session = makeSession('items-no-remove-diff');
      expect(session.removeItem('diff')).toBe(false);
      expect(session.items).toHaveLength(1);
    });
  });

  describe('getItemData', () => {
    it('returns diff data for diff item', () => {
      const session = makeSession('data-diff');
      const data = session.getItemData('diff');
      expect(data.mode).toBe('diff');
      expect(data.diff).toContain('diff --git');
      expect(data.meta).toBeDefined();
      expect((data.meta as Record<string, unknown>).branch).toBe('feature');
    });

    it('returns file content for document item', () => {
      const session = makeSession('data-doc');
      session.addItem('readme', 'README', join(fixture.repoPath, 'README.md'));
      const data = session.getItemData('readme');
      expect(data.mode).toBe('file');
      expect(data.content).toContain('Test Project');
      expect(data.markdown).toBe(true);
    });

    it('returns error for unknown item', () => {
      const session = makeSession('data-unknown');
      const data = session.getItemData('nonexistent');
      expect(data.mode).toBe('error');
    });
  });

  describe('user state', () => {
    it('toggleUserReviewedFile flips state', () => {
      const session = makeSession('user-reviewed');
      expect(session.toggleUserReviewedFile('app.ts')).toBe(true);
      expect(session.userReviewedFiles).toContain('app.ts');
      expect(session.toggleUserReviewedFile('app.ts')).toBe(false);
      expect(session.userReviewedFiles).not.toContain('app.ts');
    });

    it('setUserSidebarView persists', () => {
      const session = makeSession('user-sidebar');
      session.setUserSidebarView('phased');
      expect(session.userSidebarView).toBe('phased');
    });
  });

  describe('submitReview', () => {
    it('writes markdown to output file and increments round', async () => {
      const session = makeSession('submit-test');
      const round1 = await session.submitReview('First round comments');
      expect(round1).toBe(1);
      expect(existsSync(outputPath)).toBe(true);
      expect(readFileSync(outputPath, 'utf-8')).toContain('Review Round 1');
      expect(readFileSync(outputPath, 'utf-8')).toContain('First round comments');

      const round2 = await session.submitReview('Second round');
      expect(round2).toBe(2);
      expect(readFileSync(outputPath, 'utf-8')).toContain('Review Round 2');
    });

    it('writes signal file with round number', async () => {
      const session = makeSession('signal-test');
      await session.submitReview('Test');
      const signal = readFileSync(outputPath + '.signal', 'utf-8');
      expect(signal).toBe('diff:1');
    });
  });

  describe('persistence', () => {
    it('persist + fromBlob reconstructs session state', () => {
      const session = makeSession('persist-test');
      session.addComment({ author: 'user', text: 'Persisted comment', item: 'diff', file: 'a.ts', line: 1 });
      session.addItem('doc1', 'Design', join(fixture.repoPath, 'README.md'));
      session.toggleUserReviewedFile('src/app.ts');
      session.setUserSidebarView('grouped');
      session.persist();

      const blob = storeGet('persist-test');
      expect(blob).not.toBeNull();
      const restored = Session.fromBlob(blob as unknown as Record<string, unknown>, outputPath);
      expect(restored.listComments()).toHaveLength(1);
      expect(restored.listComments()[0].text).toBe('Persisted comment');
      expect(restored.items).toHaveLength(2);
      expect(restored.userReviewedFiles).toContain('src/app.ts');
      expect(restored.userSidebarView).toBe('grouped');
    });
  });

  describe('SSE', () => {
    it('broadcast sends event to subscribed clients', () => {
      const session = makeSession('sse-test');
      const received: { event: string; data: unknown }[] = [];
      const client: SSEClient = {
        send(event, data) { received.push({ event, data }); },
      };
      session.subscribe(client);
      session.broadcast('comments_changed', { item: 'diff' });
      expect(received).toHaveLength(1);
      expect(received[0].event).toBe('comments_changed');
      expect(received[0].data).toEqual({ item: 'diff' });
    });

    it('unsubscribe stops delivery', () => {
      const session = makeSession('sse-unsub');
      const received: unknown[] = [];
      const client: SSEClient = { send(_, data) { received.push(data); } };
      session.subscribe(client);
      session.unsubscribe(client);
      session.broadcast('test', {});
      expect(received).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test:server`

Expected: All Session tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/session.test.ts
git commit -m "tests: Session class - comments, items, data, persistence, SSE"
```

---

### Task 7: SessionManager tests

**Files:**
- Create: `server/__tests__/session-manager.test.ts`

- [ ] **Step 1: Write SessionManager tests**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import { initStore, closeStore } from '../store.js';
import { SessionManager } from '../session-manager.js';

describe('SessionManager', () => {
  let fixture: GitFixture;
  let fixture2: GitFixture;
  let tmpDir: string;

  beforeAll(() => {
    fixture = createGitFixture();
    fixture2 = createGitFixture();
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-manager-test-'));
    initStore(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeStore();
    fixture.cleanup();
    fixture2.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('register creates a session and returns slug + url', () => {
    const manager = new SessionManager(9999);
    const result = manager.register(fixture.repoPath);
    expect(result.slug).toBeTruthy();
    expect(result.url).toContain('9999');
    expect(result.url).toContain(result.slug);
  });

  it('register with same repo returns existing session (deduplication)', () => {
    const manager = new SessionManager(9999);
    const first = manager.register(fixture.repoPath);
    const second = manager.register(fixture.repoPath);
    expect(second.slug).toBe(first.slug);
  });

  it('get returns session by slug', () => {
    const manager = new SessionManager(9999);
    const { slug } = manager.register(fixture.repoPath);
    const session = manager.get(slug);
    expect(session).toBeDefined();
    expect(session?.repoPath).toBe(fixture.repoPath);
  });

  it('findByRepoPath returns session by repo path', () => {
    const manager = new SessionManager(9999);
    manager.register(fixture.repoPath);
    const result = manager.findByRepoPath(fixture.repoPath);
    expect(result).toBeDefined();
    expect(result?.session.repoPath).toBe(fixture.repoPath);
  });

  it('list returns all registered sessions', () => {
    const manager = new SessionManager(9999);
    manager.register(fixture.repoPath);
    manager.register(fixture2.repoPath);
    const list = manager.list();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('deregister removes session', () => {
    const manager = new SessionManager(9999);
    const { slug } = manager.register(fixture.repoPath);
    expect(manager.deregister(slug)).toBe(true);
    expect(manager.get(slug)).toBeUndefined();
  });

  it('deregister returns false for unknown slug', () => {
    const manager = new SessionManager(9999);
    expect(manager.deregister('nonexistent')).toBe(false);
  });

  it('handles slug collisions for repos with same directory name', () => {
    const manager = new SessionManager(9999);
    const r1 = manager.register(fixture.repoPath);
    const r2 = manager.register(fixture2.repoPath);
    expect(r1.slug).not.toBe(r2.slug);
  });

  it('restores sessions from store on construction', () => {
    // Create a manager and register a project
    const manager1 = new SessionManager(9999);
    const { slug } = manager1.register(fixture.repoPath);

    // Create a new manager — should restore from store
    const manager2 = new SessionManager(9999);
    const session = manager2.get(slug);
    expect(session).toBeDefined();
    expect(session?.repoPath).toBe(fixture.repoPath);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test:server`

Expected: All SessionManager tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/session-manager.test.ts
git commit -m "tests: SessionManager - register, dedup, lookup, deregister, restore"
```

---

### Task 8: Express route tests

**Files:**
- Create: `server/__tests__/routes.test.ts`

- [ ] **Step 1: Write route tests**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import { initStore, closeStore } from '../store.js';
import { SessionManager } from '../session-manager.js';
import { createApp } from '../app.js';

describe('routes', () => {
  let fixture: GitFixture;
  let tmpDir: string;
  let app: ReturnType<typeof createApp>;
  let slug: string;

  beforeAll(() => {
    fixture = createGitFixture();
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-routes-test-'));
    initStore(join(tmpDir, 'test.db'));
    const manager = new SessionManager(9999);
    app = createApp(manager);

    // Register the test project
    const result = manager.register(fixture.repoPath);
    slug = result.slug;
  });

  afterAll(() => {
    closeStore();
    fixture.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('project management', () => {
    it('POST /projects registers a project', async () => {
      const res = await request(app)
        .post('/projects')
        .send({ repoPath: fixture.repoPath })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.slug).toBe(slug); // Already registered, returns existing
    });

    it('POST /projects returns 400 without repoPath', async () => {
      const res = await request(app)
        .post('/projects')
        .send({})
        .expect(400);
      expect(res.body.error).toContain('repoPath');
    });

    it('GET /projects lists registered projects', async () => {
      const res = await request(app)
        .get('/projects')
        .expect(200);
      expect(res.body.projects).toBeInstanceOf(Array);
      expect(res.body.projects.some((p: { slug: string }) => p.slug === slug)).toBe(true);
    });
  });

  describe('diff and commits', () => {
    it('GET /project/:slug/data returns diff data', async () => {
      const res = await request(app)
        .get(`/project/${slug}/data?item=diff`)
        .expect(200);
      expect(res.body.mode).toBe('diff');
      expect(res.body.diff).toContain('diff --git');
      expect(res.body.meta.branch).toBe('feature');
    });

    it('GET /project/:slug/commits returns commit list', async () => {
      const res = await request(app)
        .get(`/project/${slug}/commits`)
        .expect(200);
      expect(res.body.commits).toBeInstanceOf(Array);
      expect(res.body.commits.length).toBeGreaterThan(0);
      expect(res.body.commits[0].sha).toBeTruthy();
      expect(res.body.commits[0].message).toBeTruthy();
    });
  });

  describe('comments', () => {
    let commentId: string;

    it('POST /project/:slug/comments creates a comment', async () => {
      const res = await request(app)
        .post(`/project/${slug}/comments`)
        .send({ author: 'user', text: 'Test comment', item: 'diff', file: 'src/app.ts', line: 3 })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.comment.id).toBeTruthy();
      expect(res.body.comment.author).toBe('user');
      commentId = res.body.comment.id;
    });

    it('POST /project/:slug/comments returns 400 without required fields', async () => {
      await request(app)
        .post(`/project/${slug}/comments`)
        .send({ author: 'user' })
        .expect(400);
    });

    it('GET /project/:slug/comments lists comments', async () => {
      const res = await request(app)
        .get(`/project/${slug}/comments`)
        .expect(200);
      expect(res.body.comments).toBeInstanceOf(Array);
      expect(res.body.comments.some((c: { id: string }) => c.id === commentId)).toBe(true);
    });

    it('GET /project/:slug/comments supports filter params', async () => {
      const res = await request(app)
        .get(`/project/${slug}/comments?author=user`)
        .expect(200);
      expect(res.body.comments.every((c: { author: string }) => c.author === 'user')).toBe(true);
    });

    it('PATCH /project/:slug/comments/:id updates comment', async () => {
      const res = await request(app)
        .patch(`/project/${slug}/comments/${commentId}`)
        .send({ status: 'resolved' })
        .expect(200);
      expect(res.body.comment.status).toBe('resolved');
    });

    it('DELETE /project/:slug/comments/:id removes comment', async () => {
      await request(app)
        .delete(`/project/${slug}/comments/${commentId}`)
        .expect(200);
      const res = await request(app)
        .get(`/project/${slug}/comments`)
        .expect(200);
      expect(res.body.comments.some((c: { id: string }) => c.id === commentId)).toBe(false);
    });

    it('PATCH returns 404 for nonexistent comment', async () => {
      await request(app)
        .patch(`/project/${slug}/comments/nonexistent`)
        .send({ text: 'Updated' })
        .expect(404);
    });
  });

  describe('user state', () => {
    it('GET /project/:slug/user-state returns defaults', async () => {
      const res = await request(app)
        .get(`/project/${slug}/user-state`)
        .expect(200);
      expect(res.body.reviewedFiles).toBeInstanceOf(Array);
      expect(res.body.sidebarView).toBeTruthy();
    });

    it('PUT /project/:slug/user-state/reviewed toggles file', async () => {
      const res = await request(app)
        .put(`/project/${slug}/user-state/reviewed`)
        .send({ path: 'src/app.ts' })
        .expect(200);
      expect(res.body.reviewed).toBe(true);
    });

    it('PUT /project/:slug/user-state/reviewed returns 400 without path', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/reviewed`)
        .send({})
        .expect(400);
    });

    it('PUT /project/:slug/user-state/sidebar-view sets view', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-view`)
        .send({ view: 'grouped' })
        .expect(200);
      const res = await request(app)
        .get(`/project/${slug}/user-state`)
        .expect(200);
      expect(res.body.sidebarView).toBe('grouped');
    });

    it('PUT /project/:slug/user-state/sidebar-view rejects invalid view', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-view`)
        .send({ view: 'invalid' })
        .expect(400);
    });
  });

  describe('submit', () => {
    it('POST /project/:slug/submit returns round number', async () => {
      const res = await request(app)
        .post(`/project/${slug}/submit`)
        .send({ comments: 'Looks good!' })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.round).toBe(1);
    });
  });

  describe('error handling', () => {
    it('returns 404 for unknown project slug', async () => {
      await request(app)
        .get('/project/nonexistent/data')
        .expect(404);
    });

    it('DELETE /projects/:slug returns 404 for unknown project', async () => {
      await request(app)
        .delete('/projects/nonexistent')
        .expect(404);
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test:server`

Expected: All route tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/routes.test.ts
git commit -m "tests: Express routes - projects, comments, user state, submit, errors"
```

---

### Task 9: Move existing test files into __tests__/ directory

**Files:**
- Move: `server/comment-store.test.ts` → `server/__tests__/comment-store.test.ts`
- Move: `server/comment-migration.test.ts` → `server/__tests__/comment-migration.test.ts`

For consistency — all test files should live in `server/__tests__/`.

- [ ] **Step 1: Move files and update import paths**

```bash
mv server/comment-store.test.ts server/__tests__/comment-store.test.ts
mv server/comment-migration.test.ts server/__tests__/comment-migration.test.ts
```

Update the imports in both files: change `'./comment-store.js'` to `'../comment-store.js'` and `'./comment-migration.js'` to `'../comment-migration.js'` etc.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: All tests pass (frontend + server).

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/ server/comment-store.test.ts server/comment-migration.test.ts
git commit -m "move server test files into __tests__/ directory"
```

---

### Task 10: Final validation

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: All frontend and server tests pass.

- [ ] **Step 2: Run server build**

Run: `npm run build:server`

Expected: Build succeeds (store.ts changes are backward-compatible).

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: Clean.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "server tests complete: store, git-ops, session, manager, routes"
```
