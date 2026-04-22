# File Sidebar Tree Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-mode file sidebar (Flat/Grouped/Phased) with a single composable directory-tree view — compact-folder nesting, sort/group chips when analysis exists, per-project collapse persistence, folder-level dismiss + progress, tree keyboard navigation.

**Architecture:** Pure `buildTree` + `flattenVisible` utilities produce render-ready row lists from `files()`, `analysis()`, and user state. Solid memos drive reactivity. Server-side `/user-state` persists per-project sort/group/collapse preferences, replacing the existing `sidebarView` field. A new `activeRowId` signal replaces `activeFileIdx` as the selection anchor, with an `activeFile()` memo shimming legacy readers.

**Tech Stack:** SolidJS + Vite (frontend), Express + SQLite + vitest (backend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-22-file-sidebar-tree-overhaul-design.md` — read this before starting.

**Branching:** The work touches many files across frontend + backend. Recommend running this plan in a dedicated branch (e.g. `feature/sidebar-tree`) branched from `main`, not the current `feature/project-browser` branch. Create the branch before Task 1.

---

## File Map

**Server (new/modified):**
- `server/store.ts` — modify `ProjectBlob` schema (drop `sidebarView`, add `sortMode`, `groupMode`, `groupModeUserTouched`, `collapsedFolders`).
- `server/session.ts` — rename fields, add getters/setters, update `toBlob`/`fromBlob` with backward-compat migration.
- `server/app.ts` — replace `PUT /user-state/sidebar-view` route with `PUT /user-state/sidebar-prefs`, extend `GET /user-state` response.
- `server/__tests__/routes.test.ts` — update user-state test cases.

**Frontend utilities (new):**
- `frontend/src/tree.ts` — pure tree logic (`buildTree`, `flattenVisible`, `matchesFilter`, types).
- `frontend/src/__tests__/tree.test.ts` — exhaustive tests for pure tree logic.

**Frontend state (modified):**
- `frontend/src/state.ts` — remove `sidebarView`/`SidebarView`/`activeFileIdx`; add `sortMode`, `groupMode`, `groupModeUserTouched`, `collapsedFolders`, `dismissedFolders`, `dismissedFiles` (lifted), `activeRowId`; rewrite `activeFile` memo.
- `frontend/src/api.ts` — update `UserState` interface; replace `putUserSidebarView` with `putUserSidebarPrefs`.
- `frontend/src/persistence.ts` — load/save the four new fields against the new endpoint.

**Frontend components (new):**
- `frontend/src/components/sidebar/TreeFile.tsx` — file row.
- `frontend/src/components/sidebar/TreeFolder.tsx` — folder row.
- `frontend/src/components/sidebar/SortGroupControls.tsx` — chip row.
- `frontend/src/components/sidebar/FileTree.tsx` — tree view (tree memo, visible-rows memo, keyboard scope).
- `frontend/src/__tests__/sidebar-keyboard.test.ts` — keyboard semantics.

**Frontend components (modified):**
- `frontend/src/components/sidebar/Sidebar.tsx` — rewrite shell.
- `frontend/src/components/diff/DiffView.tsx` — switch `activeFileIdx` reads to `activeFile()`.
- `frontend/src/components/diff/WholeFileView.tsx` — same.
- `frontend/src/hooks/useKeyboardShortcuts.ts` — tree nav, add `h/l/[/]/o`.
- `frontend/src/ProjectView.tsx` — hash sync + per-item state cache migrate.
- `frontend/src/style.css` — tree row styles.

**Frontend components (deleted):**
- `frontend/src/components/sidebar/FileList.tsx`
- `frontend/src/components/sidebar/ViewToggle.tsx`

---

## Task 1: Extend server schema + session fields

**Files:**
- Modify: `server/store.ts:6-17`
- Modify: `server/session.ts:43-44`, `:83-86`, `:111-113`, `:278-300`

- [ ] **Step 1: Modify `ProjectBlob` schema**

Edit `server/store.ts` — replace `sidebarView: string;` at line 16 with the four new fields. Keep `reviewedFiles: string[];` unchanged.

Replace:

```ts
  reviewedFiles: string[];
  sidebarView: string;
}
```

with:

```ts
  reviewedFiles: string[];
  sortMode: 'path' | 'priority';
  groupMode: 'none' | 'phase';
  groupModeUserTouched: boolean;
  collapsedFolders: Record<string, boolean>;
}
```

- [ ] **Step 2: Update Session private fields**

In `server/session.ts`, replace line 44 (`private _sidebarView = 'flat';`) with:

```ts
  private _sortMode: 'path' | 'priority' = 'path';
  private _groupMode: 'none' | 'phase' = 'none';
  private _groupModeUserTouched = false;
  private _collapsedFolders: Record<string, boolean> = {};
```

- [ ] **Step 3: Update `toBlob`**

In `server/session.ts`, replace `sidebarView: this._sidebarView,` in `toBlob` (around line 84) with:

```ts
      sortMode: this._sortMode,
      groupMode: this._groupMode,
      groupModeUserTouched: this._groupModeUserTouched,
      collapsedFolders: this._collapsedFolders,
```

- [ ] **Step 4: Update `fromBlob` with migration**

In `server/session.ts`, replace line 112 (`session._sidebarView = (migrated.sidebarView as string) ?? 'flat';`) with:

```ts
    session._sortMode = (migrated.sortMode as 'path' | 'priority') ?? 'path';
    session._groupMode = (migrated.groupMode as 'none' | 'phase') ?? 'none';
    session._groupModeUserTouched = (migrated.groupModeUserTouched as boolean) ?? false;
    session._collapsedFolders = (migrated.collapsedFolders as Record<string, boolean>) ?? {};
    // Legacy `sidebarView` field is read and discarded; persisted blobs will no longer include it.
```

- [ ] **Step 5: Replace public getter/setter**

In `server/session.ts`, replace the block around lines 281-301 that defines `userSidebarView` getter and `setUserSidebarView`:

```ts
  get userSidebarView(): string {
    return this._sidebarView;
  }
```
and
```ts
  setUserSidebarView(view: string): void {
    this._sidebarView = view;
    this.persist();
  }
```

with:

```ts
  get userSidebarPrefs(): {
    sortMode: 'path' | 'priority';
    groupMode: 'none' | 'phase';
    groupModeUserTouched: boolean;
    collapsedFolders: Record<string, boolean>;
  } {
    return {
      sortMode: this._sortMode,
      groupMode: this._groupMode,
      groupModeUserTouched: this._groupModeUserTouched,
      collapsedFolders: this._collapsedFolders,
    };
  }

  setUserSidebarPrefs(prefs: Partial<{
    sortMode: 'path' | 'priority';
    groupMode: 'none' | 'phase';
    groupModeUserTouched: boolean;
    collapsedFolders: Record<string, boolean>;
  }>): void {
    if (prefs.sortMode !== undefined) this._sortMode = prefs.sortMode;
    if (prefs.groupMode !== undefined) this._groupMode = prefs.groupMode;
    if (prefs.groupModeUserTouched !== undefined) this._groupModeUserTouched = prefs.groupModeUserTouched;
    if (prefs.collapsedFolders !== undefined) this._collapsedFolders = prefs.collapsedFolders;
    this.persist();
  }
```

- [ ] **Step 6: Run build to verify types compile**

Run: `npm run build:server`
Expected: should fail at `server/app.ts` where `session.userSidebarView` / `session.setUserSidebarView` are still referenced. That's expected — Task 2 fixes it.

- [ ] **Step 7: Commit**

```bash
git add server/store.ts server/session.ts
git commit -m "server: replace sidebarView blob field with tree prefs schema"
```

---

## Task 2: Update /user-state routes + route tests

**Files:**
- Modify: `server/app.ts:429-457`
- Modify: `server/__tests__/routes.test.ts:222-263`

- [ ] **Step 1: Update failing test expectations first (TDD)**

In `server/__tests__/routes.test.ts`, replace the `describe('user state', ...)` block (around lines 222-263). Delete the old `sidebar-view` cases; add `sidebar-prefs` cases:

```ts
  describe('user state', () => {
    it('GET /project/:slug/user-state returns defaults', async () => {
      const res = await request(app)
        .get(`/project/${slug}/user-state`)
        .expect(200);
      expect(res.body.reviewedFiles).toBeInstanceOf(Array);
      expect(res.body.sortMode).toBe('path');
      expect(res.body.groupMode).toBe('none');
      expect(res.body.groupModeUserTouched).toBe(false);
      expect(res.body.collapsedFolders).toEqual({});
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

    it('PUT /project/:slug/user-state/sidebar-prefs accepts partial updates', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-prefs`)
        .send({ sortMode: 'priority' })
        .expect(200);
      const res = await request(app)
        .get(`/project/${slug}/user-state`)
        .expect(200);
      expect(res.body.sortMode).toBe('priority');
      expect(res.body.groupMode).toBe('none');
    });

    it('PUT /project/:slug/user-state/sidebar-prefs merges collapsedFolders', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-prefs`)
        .send({ collapsedFolders: { 'frontend/src/': true } })
        .expect(200);
      const res = await request(app)
        .get(`/project/${slug}/user-state`)
        .expect(200);
      expect(res.body.collapsedFolders).toEqual({ 'frontend/src/': true });
    });

    it('PUT /project/:slug/user-state/sidebar-prefs rejects invalid sortMode', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-prefs`)
        .send({ sortMode: 'nope' })
        .expect(400);
    });

    it('PUT /project/:slug/user-state/sidebar-prefs rejects invalid groupMode', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-prefs`)
        .send({ groupMode: 'bogus' })
        .expect(400);
    });
  });
```

- [ ] **Step 2: Run the route tests — they must fail**

Run: `npx vitest run server/__tests__/routes.test.ts -t "user state"`
Expected: failures on `sidebar-prefs` cases (endpoint doesn't exist yet) and on the GET defaults test (server still returns `sidebarView`).

- [ ] **Step 3: Replace the routes in `server/app.ts`**

Replace lines 429-457 (the `GET /user-state`, `PUT /user-state/reviewed`, and `PUT /user-state/sidebar-view` block — keep `POST /user-state/clear` untouched) with:

```ts
  projectRouter.get('/user-state', (_req, res) => {
    const session = res.locals.session;
    res.json({
      reviewedFiles: session.userReviewedFiles,
      ...session.userSidebarPrefs,
    });
  });

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

  projectRouter.put('/user-state/sidebar-prefs', (req, res) => {
    const session = res.locals.session;
    const prefs: {
      sortMode?: 'path' | 'priority';
      groupMode?: 'none' | 'phase';
      groupModeUserTouched?: boolean;
      collapsedFolders?: Record<string, boolean>;
    } = {};

    const { sortMode, groupMode, groupModeUserTouched, collapsedFolders } = req.body ?? {};

    if (sortMode !== undefined) {
      if (sortMode !== 'path' && sortMode !== 'priority') {
        res.status(400).json({ error: 'sortMode must be path or priority' });
        return;
      }
      prefs.sortMode = sortMode;
    }

    if (groupMode !== undefined) {
      if (groupMode !== 'none' && groupMode !== 'phase') {
        res.status(400).json({ error: 'groupMode must be none or phase' });
        return;
      }
      prefs.groupMode = groupMode;
    }

    if (groupModeUserTouched !== undefined) {
      if (typeof groupModeUserTouched !== 'boolean') {
        res.status(400).json({ error: 'groupModeUserTouched must be boolean' });
        return;
      }
      prefs.groupModeUserTouched = groupModeUserTouched;
    }

    if (collapsedFolders !== undefined) {
      if (typeof collapsedFolders !== 'object' || collapsedFolders === null || Array.isArray(collapsedFolders)) {
        res.status(400).json({ error: 'collapsedFolders must be an object' });
        return;
      }
      prefs.collapsedFolders = collapsedFolders;
    }

    session.setUserSidebarPrefs(prefs);
    res.json({ ok: true });
  });
```

- [ ] **Step 4: Run the route tests — they must pass**

Run: `npx vitest run server/__tests__/routes.test.ts -t "user state"`
Expected: all user-state cases pass.

- [ ] **Step 5: Run full server test suite**

Run: `npm run test:server`
Expected: all tests pass. (If `session.test.ts` exercises the old `setUserSidebarView`, it must be updated too — check the test output; the fix is to remove or retarget any such case.)

- [ ] **Step 6: Commit**

```bash
git add server/app.ts server/__tests__/routes.test.ts
git commit -m "server: replace sidebar-view route with sidebar-prefs endpoint"
```

---

## Task 3: Tree types and empty/simple tree

**Files:**
- Create: `frontend/src/tree.ts`
- Create: `frontend/src/__tests__/tree.test.ts`

- [ ] **Step 1: Write types and failing tests**

Create `frontend/src/__tests__/tree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTree } from '../tree';
import type { DiffFile, Analysis } from '../state';

function makeFile(path: string, additions = 10, deletions = 5): DiffFile {
  return { path, additions, deletions, lines: [] };
}

describe('buildTree — empty and flat', () => {
  it('returns [] for no files', () => {
    const tree = buildTree([], null, { sort: 'path', group: 'none' });
    expect(tree).toEqual([]);
  });

  it('produces a single flat file list when no directories', () => {
    const files = [makeFile('a.ts'), makeFile('b.ts')];
    const tree = buildTree(files, null, { sort: 'path', group: 'none' });
    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({ kind: 'file', id: 'a.ts' });
    expect(tree[1]).toMatchObject({ kind: 'file', id: 'b.ts' });
  });

  it('produces nested folders for single-level paths', () => {
    const files = [makeFile('server/app.ts'), makeFile('server/session.ts')];
    const tree = buildTree(files, null, { sort: 'path', group: 'none' });
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ kind: 'folder', name: 'server/', fullPath: 'server/', depth: 0 });
    expect(tree[0].kind === 'folder' && tree[0].children).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Create `tree.ts` with types and a minimal `buildTree`**

Create `frontend/src/tree.ts`:

```ts
import type { DiffFile, Analysis } from './state';

export interface FolderNode {
  kind: 'folder';
  id: string;
  name: string;
  fullPath: string;
  depth: number;
  children: TreeNode[];
}

export interface FileNode {
  kind: 'file';
  id: string;
  file: DiffFile;
  depth: number;
}

export type TreeNode = FolderNode | FileNode;

export interface BuildOpts {
  sort: 'path' | 'priority';
  group: 'none' | 'phase';
}

interface TrieNode {
  dirs: Map<string, TrieNode>;
  files: DiffFile[];
}

function emptyTrie(): TrieNode {
  return { dirs: new Map(), files: [] };
}

function insert(trie: TrieNode, file: DiffFile): void {
  const segments = file.path.split('/');
  const fileName = segments.pop()!;
  let node = trie;
  for (const seg of segments) {
    if (!node.dirs.has(seg)) node.dirs.set(seg, emptyTrie());
    node = node.dirs.get(seg)!;
  }
  node.files.push({ ...file, path: file.path });
  // Note: we store the file by its full path; the basename is `fileName` and used only for display.
  void fileName;
}

function buildFromTrie(trie: TrieNode, pathPrefix: string, depth: number, idPrefix: string): TreeNode[] {
  const out: TreeNode[] = [];

  for (const [dirName, sub] of trie.dirs) {
    const folderPath = pathPrefix + dirName + '/';
    const folder: FolderNode = {
      kind: 'folder',
      id: idPrefix + folderPath,
      name: dirName + '/',
      fullPath: folderPath,
      depth,
      children: buildFromTrie(sub, folderPath, depth + 1, idPrefix),
    };
    out.push(folder);
  }

  for (const f of trie.files) {
    out.push({
      kind: 'file',
      id: idPrefix + f.path,
      file: f,
      depth,
    });
  }

  return out;
}

export function buildTree(files: DiffFile[], _analysis: Analysis | null, _opts: BuildOpts): TreeNode[] {
  const trie = emptyTrie();
  for (const f of files) insert(trie, f);
  return buildFromTrie(trie, '', 0, '');
}
```

- [ ] **Step 3: Run the tests — must pass**

Run: `npx vitest run frontend/src/__tests__/tree.test.ts`
Expected: all 3 cases pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/tree.ts frontend/src/__tests__/tree.test.ts
git commit -m "tree: scaffold buildTree with trie + simple nesting"
```

---

## Task 4: Compact-folder merging

**Files:**
- Modify: `frontend/src/tree.ts`
- Modify: `frontend/src/__tests__/tree.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `frontend/src/__tests__/tree.test.ts`:

```ts
describe('buildTree — compact folders', () => {
  it('merges single-child directory chains', () => {
    const files = [makeFile('frontend/src/components/sidebar/FileList.tsx')];
    const tree = buildTree(files, null, { sort: 'path', group: 'none' });
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      kind: 'folder',
      name: 'frontend/src/components/sidebar/',
      fullPath: 'frontend/src/components/sidebar/',
      depth: 0,
    });
  });

  it('stops merging when a chain branches', () => {
    const files = [
      makeFile('frontend/src/a.ts'),
      makeFile('frontend/dist/b.js'),
    ];
    const tree = buildTree(files, null, { sort: 'path', group: 'none' });
    expect(tree).toHaveLength(1);
    const frontend = tree[0] as any;
    expect(frontend.name).toBe('frontend/');
    expect(frontend.children).toHaveLength(2); // src/, dist/
  });

  it('stops merging when a directory contains files', () => {
    // frontend/ has its own file → cannot merge with src/
    const files = [
      makeFile('frontend/README.md'),
      makeFile('frontend/src/app.ts'),
    ];
    const tree = buildTree(files, null, { sort: 'path', group: 'none' });
    expect(tree).toHaveLength(1);
    const frontend = tree[0] as any;
    expect(frontend.name).toBe('frontend/');
    expect(frontend.children).toHaveLength(2); // src/ folder + README.md file
    const srcFolder = frontend.children.find((c: any) => c.kind === 'folder');
    expect(srcFolder.name).toBe('src/');
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run frontend/src/__tests__/tree.test.ts -t "compact folders"`
Expected: failures — current `buildFromTrie` does not merge.

- [ ] **Step 3: Implement compaction**

In `frontend/src/tree.ts`, replace `buildFromTrie` with:

```ts
function buildFromTrie(trie: TrieNode, pathPrefix: string, depth: number, idPrefix: string): TreeNode[] {
  const out: TreeNode[] = [];

  for (const [dirName, sub] of trie.dirs) {
    // Walk a single-child chain and merge
    let chain = dirName + '/';
    let curPrefix = pathPrefix + chain;
    let cur = sub;
    while (cur.files.length === 0 && cur.dirs.size === 1) {
      const [nextName, nextNode] = cur.dirs.entries().next().value as [string, TrieNode];
      chain += nextName + '/';
      curPrefix += nextName + '/';
      cur = nextNode;
    }

    const folder: FolderNode = {
      kind: 'folder',
      id: idPrefix + curPrefix,
      name: chain,
      fullPath: curPrefix,
      depth,
      children: buildFromTrie(cur, curPrefix, depth + 1, idPrefix),
    };
    out.push(folder);
  }

  for (const f of trie.files) {
    out.push({
      kind: 'file',
      id: idPrefix + f.path,
      file: f,
      depth,
    });
  }

  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run frontend/src/__tests__/tree.test.ts`
Expected: all tests pass (simple + compact-folder cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tree.ts frontend/src/__tests__/tree.test.ts
git commit -m "tree: merge single-child directory chains into compact folder rows"
```

---

## Task 5: Phase grouping

**Files:**
- Modify: `frontend/src/tree.ts`
- Modify: `frontend/src/__tests__/tree.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `frontend/src/__tests__/tree.test.ts`:

```ts
describe('buildTree — phase grouping', () => {
  const analysis: Analysis = {
    overview: '',
    reviewStrategy: '',
    files: {
      'server/app.ts': { priority: 'critical', phase: 'review', summary: '', category: '' },
      'server/log.ts': { priority: 'normal', phase: 'skim', summary: '', category: '' },
      'dist/out.js': { priority: 'low', phase: 'rubber-stamp', summary: '', category: '' },
    },
    groups: [],
  };

  it('produces three synthetic phase roots in fixed order', () => {
    const files = [makeFile('server/app.ts'), makeFile('server/log.ts'), makeFile('dist/out.js')];
    const tree = buildTree(files, analysis, { sort: 'path', group: 'phase' });
    expect(tree).toHaveLength(3);
    expect(tree.map((n) => (n as any).name)).toEqual([
      '● Review carefully',
      '◐ Skim',
      '○ Rubber stamp',
    ]);
    expect(tree.every((n) => n.kind === 'folder')).toBe(true);
  });

  it('builds an independent compact-folder subtree under each phase', () => {
    const files = [makeFile('server/app.ts'), makeFile('server/log.ts'), makeFile('dist/out.js')];
    const tree = buildTree(files, analysis, { sort: 'path', group: 'phase' });
    const reviewRoot = tree[0] as any;
    expect(reviewRoot.children).toHaveLength(1);
    expect(reviewRoot.children[0].name).toBe('server/');
    expect(reviewRoot.children[0].children).toHaveLength(1);
    expect(reviewRoot.children[0].children[0].id).toBe('review:server/app.ts');
  });

  it('omits a phase root with no files', () => {
    const files = [makeFile('server/app.ts')];
    const tree = buildTree(files, analysis, { sort: 'path', group: 'phase' });
    expect(tree).toHaveLength(1);
    expect((tree[0] as any).name).toBe('● Review carefully');
  });

  it('defaults to phase=skim when a file lacks analysis', () => {
    const files = [makeFile('unknown.ts')];
    const tree = buildTree(files, analysis, { sort: 'path', group: 'phase' });
    expect(tree).toHaveLength(1);
    expect((tree[0] as any).name).toBe('◐ Skim');
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run frontend/src/__tests__/tree.test.ts -t "phase grouping"`
Expected: failures — `buildTree` ignores `group` option.

- [ ] **Step 3: Implement phase grouping**

In `frontend/src/tree.ts`, add near the top after `BuildOpts`:

```ts
const PHASE_ORDER = ['review', 'skim', 'rubber-stamp'] as const;
type Phase = (typeof PHASE_ORDER)[number];

const PHASE_LABEL: Record<Phase, string> = {
  review: '● Review carefully',
  skim: '◐ Skim',
  'rubber-stamp': '○ Rubber stamp',
};

function filePhase(file: DiffFile, analysis: Analysis | null): Phase {
  return (analysis?.files[file.path]?.phase as Phase) ?? 'skim';
}
```

Then replace `buildTree` with:

```ts
export function buildTree(files: DiffFile[], analysis: Analysis | null, opts: BuildOpts): TreeNode[] {
  if (opts.group === 'phase' && analysis) {
    const byPhase: Record<Phase, DiffFile[]> = { review: [], skim: [], 'rubber-stamp': [] };
    for (const f of files) byPhase[filePhase(f, analysis)].push(f);

    const roots: TreeNode[] = [];
    for (const phase of PHASE_ORDER) {
      const phaseFiles = byPhase[phase];
      if (phaseFiles.length === 0) continue;
      const trie = emptyTrie();
      for (const f of phaseFiles) insert(trie, f);
      const idPrefix = phase + ':';
      roots.push({
        kind: 'folder',
        id: idPrefix + '__root__',
        name: PHASE_LABEL[phase],
        fullPath: idPrefix + '__root__',
        depth: 0,
        children: buildFromTrie(trie, '', 1, idPrefix),
      });
    }
    return roots;
  }

  const trie = emptyTrie();
  for (const f of files) insert(trie, f);
  return buildFromTrie(trie, '', 0, '');
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run frontend/src/__tests__/tree.test.ts`
Expected: all cases pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tree.ts frontend/src/__tests__/tree.test.ts
git commit -m "tree: phase grouping with three synthetic roots in fixed order"
```

---

## Task 6: Sort modes and Claude-comments-first float

**Files:**
- Modify: `frontend/src/tree.ts`
- Modify: `frontend/src/__tests__/tree.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `frontend/src/__tests__/tree.test.ts`:

```ts
describe('buildTree — sort', () => {
  it('sort=path orders files alphabetically within a folder, folders before files', () => {
    const files = [
      makeFile('z.ts'),
      makeFile('a.ts'),
      makeFile('sub/b.ts'),
    ];
    const tree = buildTree(files, null, { sort: 'path', group: 'none' });
    expect(tree.map((n) => (n as any).name ?? (n as any).file.path)).toEqual([
      'sub/',
      'a.ts',
      'z.ts',
    ]);
  });

  it('sort=priority orders critical → important → normal → low with path tie-break', () => {
    const analysis: Analysis = {
      overview: '', reviewStrategy: '', groups: [],
      files: {
        'b.ts': { priority: 'critical', phase: 'review', summary: '', category: '' },
        'a.ts': { priority: 'normal', phase: 'skim', summary: '', category: '' },
        'c.ts': { priority: 'critical', phase: 'review', summary: '', category: '' },
        'd.ts': { priority: 'low', phase: 'rubber-stamp', summary: '', category: '' },
      },
    };
    const files = [makeFile('a.ts'), makeFile('b.ts'), makeFile('c.ts'), makeFile('d.ts')];
    const tree = buildTree(files, analysis, { sort: 'priority', group: 'none' });
    expect(tree.map((n) => (n as any).file.path)).toEqual(['b.ts', 'c.ts', 'a.ts', 'd.ts']);
  });

  it('sort=priority falls back to path sort when analysis is null', () => {
    const files = [makeFile('z.ts'), makeFile('a.ts')];
    const tree = buildTree(files, null, { sort: 'priority', group: 'none' });
    expect(tree.map((n) => (n as any).file.path)).toEqual(['a.ts', 'z.ts']);
  });
});

describe('buildTree — Claude-comments-first', () => {
  it('floats files with claudeComments to top within their folder', () => {
    const files = [
      { ...makeFile('a.ts') },
      { ...makeFile('b.ts') },
      { ...makeFile('c.ts') },
    ];
    const claudeCommentedPaths = new Set(['c.ts']);
    const tree = buildTree(files, null, {
      sort: 'path',
      group: 'none',
      claudeCommentedPaths,
    } as any);
    expect(tree.map((n) => (n as any).file.path)).toEqual(['c.ts', 'a.ts', 'b.ts']);
  });

  it('floats claude-commented files within phase roots, per folder', () => {
    const analysis: Analysis = {
      overview: '', reviewStrategy: '', groups: [],
      files: {
        'x/a.ts': { priority: 'normal', phase: 'skim', summary: '', category: '' },
        'x/b.ts': { priority: 'normal', phase: 'skim', summary: '', category: '' },
      },
    };
    const files = [makeFile('x/a.ts'), makeFile('x/b.ts')];
    const claudeCommentedPaths = new Set(['x/b.ts']);
    const tree = buildTree(files, analysis, {
      sort: 'path', group: 'phase', claudeCommentedPaths,
    } as any);
    const skimRoot = tree[0] as any;
    const xFolder = skimRoot.children[0];
    expect(xFolder.children.map((n: any) => n.file.path)).toEqual(['x/b.ts', 'x/a.ts']);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run frontend/src/__tests__/tree.test.ts -t "sort|Claude"`
Expected: failures — `buildTree` doesn't sort and doesn't accept `claudeCommentedPaths`.

- [ ] **Step 3: Extend `BuildOpts` and sorting**

In `frontend/src/tree.ts`:

Replace `BuildOpts` with:

```ts
export interface BuildOpts {
  sort: 'path' | 'priority';
  group: 'none' | 'phase';
  claudeCommentedPaths?: Set<string>;
}
```

Add near the phase constants:

```ts
const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  important: 1,
  normal: 2,
  low: 3,
};

function priorityRank(file: DiffFile, analysis: Analysis | null): number {
  if (!analysis) return 3;
  return PRIORITY_ORDER[analysis.files[file.path]?.priority ?? 'low'] ?? 3;
}
```

Replace `buildFromTrie` with the sorted version — folders first (alphabetical), then files (comments-first float → active sort → path tie-break):

```ts
function buildFromTrie(
  trie: TrieNode,
  pathPrefix: string,
  depth: number,
  idPrefix: string,
  opts: BuildOpts,
  analysis: Analysis | null,
): TreeNode[] {
  const folders: FolderNode[] = [];

  const dirEntries = Array.from(trie.dirs.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [dirName, sub] of dirEntries) {
    let chain = dirName + '/';
    let curPrefix = pathPrefix + chain;
    let cur = sub;
    while (cur.files.length === 0 && cur.dirs.size === 1) {
      const [nextName, nextNode] = cur.dirs.entries().next().value as [string, TrieNode];
      chain += nextName + '/';
      curPrefix += nextName + '/';
      cur = nextNode;
    }

    folders.push({
      kind: 'folder',
      id: idPrefix + curPrefix,
      name: chain,
      fullPath: curPrefix,
      depth,
      children: buildFromTrie(cur, curPrefix, depth + 1, idPrefix, opts, analysis),
    });
  }

  const filesSorted = [...trie.files].sort((a, b) => {
    const aClaude = opts.claudeCommentedPaths?.has(a.path) ? 0 : 1;
    const bClaude = opts.claudeCommentedPaths?.has(b.path) ? 0 : 1;
    if (aClaude !== bClaude) return aClaude - bClaude;

    if (opts.sort === 'priority') {
      const pa = priorityRank(a, analysis);
      const pb = priorityRank(b, analysis);
      if (pa !== pb) return pa - pb;
    }

    return a.path.localeCompare(b.path);
  });

  const fileNodes: FileNode[] = filesSorted.map((f) => ({
    kind: 'file',
    id: idPrefix + f.path,
    file: f,
    depth,
  }));

  return [...folders, ...fileNodes];
}
```

Update callers of `buildFromTrie` inside `buildTree` to pass `opts` and `analysis`. Replace the entire `buildTree`:

```ts
export function buildTree(files: DiffFile[], analysis: Analysis | null, opts: BuildOpts): TreeNode[] {
  if (opts.group === 'phase' && analysis) {
    const byPhase: Record<Phase, DiffFile[]> = { review: [], skim: [], 'rubber-stamp': [] };
    for (const f of files) byPhase[filePhase(f, analysis)].push(f);

    const roots: TreeNode[] = [];
    for (const phase of PHASE_ORDER) {
      const phaseFiles = byPhase[phase];
      if (phaseFiles.length === 0) continue;
      const trie = emptyTrie();
      for (const f of phaseFiles) insert(trie, f);
      const idPrefix = phase + ':';
      roots.push({
        kind: 'folder',
        id: idPrefix + '__root__',
        name: PHASE_LABEL[phase],
        fullPath: idPrefix + '__root__',
        depth: 0,
        children: buildFromTrie(trie, '', 1, idPrefix, opts, analysis),
      });
    }
    return roots;
  }

  const trie = emptyTrie();
  for (const f of files) insert(trie, f);
  return buildFromTrie(trie, '', 0, '', opts, analysis);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run frontend/src/__tests__/tree.test.ts`
Expected: all tests pass (simple + compact + phase + sort + Claude-float).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tree.ts frontend/src/__tests__/tree.test.ts
git commit -m "tree: sort modes (path/priority) with Claude-comments-first float"
```

---

## Task 7: flattenVisible — filter, dismiss, collapse, auto-expand

**Files:**
- Modify: `frontend/src/tree.ts`
- Modify: `frontend/src/__tests__/tree.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `frontend/src/__tests__/tree.test.ts`:

```ts
import { flattenVisible, matchesFilter } from '../tree';

describe('matchesFilter', () => {
  it('matches substring', () => {
    expect(matchesFilter('src/app.ts', 'app')).toBe(true);
    expect(matchesFilter('src/app.ts', 'nope')).toBe(false);
  });
  it('supports glob star', () => {
    expect(matchesFilter('src/app.ts', '*.ts')).toBe(true);
  });
  it('supports negation', () => {
    expect(matchesFilter('src/app.ts', '!test')).toBe(true);
    expect(matchesFilter('src/test.ts', '!test')).toBe(false);
  });
  it('ANDs space-separated terms', () => {
    expect(matchesFilter('src/auth/login.ts', 'auth login')).toBe(true);
    expect(matchesFilter('src/auth/login.ts', 'auth nope')).toBe(false);
  });
});

describe('flattenVisible', () => {
  const files = [
    makeFile('a.ts'),
    makeFile('sub/b.ts'),
    makeFile('sub/c.ts'),
    makeFile('other/d.ts'),
  ];
  const tree = buildTree(files, null, { sort: 'path', group: 'none' });

  it('expanded tree yields folders and files in order', () => {
    const rows = flattenVisible(tree, {
      collapsedFolders: {}, dismissedFolders: new Set(), dismissedFiles: new Set(), filterQuery: '',
    });
    expect(rows.map((r) => r.id)).toEqual([
      'other/', 'other/d.ts',
      'sub/', 'sub/b.ts', 'sub/c.ts',
      'a.ts',
    ]);
  });

  it('collapsed folder hides its children', () => {
    const rows = flattenVisible(tree, {
      collapsedFolders: { 'sub/': true },
      dismissedFolders: new Set(), dismissedFiles: new Set(), filterQuery: '',
    });
    expect(rows.map((r) => r.id)).toEqual([
      'other/', 'other/d.ts',
      'sub/',
      'a.ts',
    ]);
  });

  it('dismissed folder hides entire subtree', () => {
    const rows = flattenVisible(tree, {
      collapsedFolders: {},
      dismissedFolders: new Set(['sub/']),
      dismissedFiles: new Set(), filterQuery: '',
    });
    expect(rows.map((r) => r.id)).toEqual([
      'other/', 'other/d.ts',
      'a.ts',
    ]);
  });

  it('dismissed file hides just that file', () => {
    const rows = flattenVisible(tree, {
      collapsedFolders: {},
      dismissedFolders: new Set(),
      dismissedFiles: new Set(['sub/b.ts']),
      filterQuery: '',
    });
    expect(rows.map((r) => r.id)).toEqual([
      'other/', 'other/d.ts',
      'sub/', 'sub/c.ts',
      'a.ts',
    ]);
  });

  it('filter hides non-matching files and empty folders', () => {
    const rows = flattenVisible(tree, {
      collapsedFolders: {}, dismissedFolders: new Set(), dismissedFiles: new Set(),
      filterQuery: 'c.ts',
    });
    expect(rows.map((r) => r.id)).toEqual(['sub/', 'sub/c.ts']);
  });

  it('filter auto-expands collapsed folders with matches', () => {
    const rows = flattenVisible(tree, {
      collapsedFolders: { 'sub/': true },
      dismissedFolders: new Set(), dismissedFiles: new Set(),
      filterQuery: 'b.ts',
    });
    expect(rows.map((r) => r.id)).toEqual(['sub/', 'sub/b.ts']);
  });

  it('filter overrides dismiss (matching dismissed file becomes visible)', () => {
    const rows = flattenVisible(tree, {
      collapsedFolders: {}, dismissedFolders: new Set(['sub/']), dismissedFiles: new Set(),
      filterQuery: 'b.ts',
    });
    expect(rows.map((r) => r.id)).toEqual(['sub/', 'sub/b.ts']);
  });

  it('folder-path query makes all descendants visible even when files do not match', () => {
    const rows = flattenVisible(tree, {
      collapsedFolders: {}, dismissedFolders: new Set(), dismissedFiles: new Set(),
      filterQuery: 'sub/',
    });
    expect(rows.map((r) => r.id)).toEqual(['sub/', 'sub/b.ts', 'sub/c.ts']);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run frontend/src/__tests__/tree.test.ts -t "matchesFilter|flattenVisible"`
Expected: failures — functions don't exist.

- [ ] **Step 3: Implement `matchesFilter` and `flattenVisible`**

In `frontend/src/tree.ts`, append:

```ts
// --- Filter ---

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp('^' + escaped + '$');
}

function termMatches(path: string, term: string): boolean {
  if (term.includes('*')) {
    const re = globToRegex(term);
    const basename = path.split('/').pop() || path;
    return re.test(path) || re.test(basename);
  }
  return path.includes(term);
}

export function matchesFilter(path: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const lower = path.toLowerCase();
  const terms = q.split(/\s+/);
  return terms.every((term) => {
    if (term.startsWith('!')) {
      const neg = term.slice(1);
      if (!neg) return true;
      return !termMatches(lower, neg);
    }
    return termMatches(lower, term);
  });
}

// --- Flatten ---

export interface FlattenOpts {
  collapsedFolders: Record<string, boolean>;
  dismissedFolders: Set<string>;
  dismissedFiles: Set<string>;
  filterQuery: string;
}

interface VisibleResult {
  rows: TreeNode[];
  anyVisible: boolean;
}

function visitFolder(node: FolderNode, opts: FlattenOpts, ancestorFolderMatched: boolean): VisibleResult {
  const filterActive = opts.filterQuery.trim().length > 0;

  // Check folder dismiss (overridden by filter match).
  const folderSelfMatches = filterActive && matchesFilter(node.fullPath, opts.filterQuery);
  const isDismissed = opts.dismissedFolders.has(node.fullPath);
  if (isDismissed && !folderSelfMatches && !ancestorFolderMatched) {
    return { rows: [], anyVisible: false };
  }

  const childMatched = ancestorFolderMatched || folderSelfMatches;
  const childRows: TreeNode[] = [];
  let anyChildVisible = false;

  for (const child of node.children) {
    if (child.kind === 'folder') {
      const sub = visitFolder(child, opts, childMatched);
      if (sub.anyVisible) {
        anyChildVisible = true;
        childRows.push(...sub.rows);
      }
    } else {
      const fileVisible = visitFile(child, opts, childMatched);
      if (fileVisible) {
        anyChildVisible = true;
        childRows.push(child);
      }
    }
  }

  if (!anyChildVisible && !folderSelfMatches) {
    return { rows: [], anyVisible: false };
  }

  const collapsed = opts.collapsedFolders[node.fullPath] === true && !filterActive;
  const rows: TreeNode[] = collapsed ? [node] : [node, ...childRows];
  return { rows, anyVisible: true };
}

function visitFile(node: FileNode, opts: FlattenOpts, ancestorFolderMatched: boolean): boolean {
  const filterActive = opts.filterQuery.trim().length > 0;
  const matches = filterActive ? matchesFilter(node.file.path, opts.filterQuery) : true;
  const effectiveMatch = ancestorFolderMatched || matches;

  if (!effectiveMatch) return false;

  const dismissed = opts.dismissedFiles.has(node.file.path);
  if (dismissed && !filterActive) return false;
  if (dismissed && filterActive && !matches && !ancestorFolderMatched) return false;

  return true;
}

export function flattenVisible(tree: TreeNode[], opts: FlattenOpts): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of tree) {
    if (node.kind === 'folder') {
      const sub = visitFolder(node, opts, false);
      if (sub.anyVisible) out.push(...sub.rows);
    } else {
      if (visitFile(node, opts, false)) out.push(node);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run frontend/src/__tests__/tree.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tree.ts frontend/src/__tests__/tree.test.ts
git commit -m "tree: flattenVisible + matchesFilter with collapse, dismiss, filter, auto-expand"
```

---

## Task 8: Add new frontend state signals

**Files:**
- Modify: `frontend/src/state.ts`

- [ ] **Step 1: Add new signals and types alongside existing ones**

In `frontend/src/state.ts`, at the end of the `--- Signals (replaced wholesale) ---` section (after line 88 where `analysis` is defined), **add**:

```ts
export type SortMode = 'path' | 'priority';
export type GroupMode = 'none' | 'phase';

export const [sortMode, setSortMode] = createSignal<SortMode>('path');
export const [groupMode, setGroupMode] = createSignal<GroupMode>('none');
export const [groupModeUserTouched, setGroupModeUserTouched] = createSignal(false);
export const [activeRowId, setActiveRowId] = createSignal<string | null>(null);
```

Also add in the `--- Stores (partial updates) ---` section (around line 160):

```ts
export const [collapsedFolders, setCollapsedFolders] = createStore<Record<string, boolean>>({});

export function toggleFolderCollapsed(fullPath: string) {
  setCollapsedFolders(fullPath, (v) => !v);
}

export const [dismissedFiles, setDismissedFilesStore] = createStore<Record<string, boolean>>({});
export const [dismissedFolders, setDismissedFoldersStore] = createStore<Record<string, boolean>>({});

export function dismissFile(path: string) {
  setDismissedFilesStore(path, true);
}
export function dismissFolder(fullPath: string) {
  setDismissedFoldersStore(fullPath, true);
}
export function undismissAll() {
  for (const k of Object.keys(dismissedFiles)) setDismissedFilesStore(k, undefined!);
  for (const k of Object.keys(dismissedFolders)) setDismissedFoldersStore(k, undefined!);
}
```

- [ ] **Step 2: Leave `sidebarView` / `activeFileIdx` / `activeFile` in place for now**

Do NOT remove these yet — later tasks migrate their consumers. We want a working build at each step.

- [ ] **Step 3: Run build**

Run: `npm run build:frontend`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/state.ts
git commit -m "state: add sortMode/groupMode/collapsedFolders/dismissedFolders/activeRowId signals"
```

---

## Task 9: Rewrite `activeFile` memo to resolve via `activeRowId`

**Files:**
- Modify: `frontend/src/state.ts`

- [ ] **Step 1: Create a shared visible-rows memo**

In `frontend/src/state.ts`, near the other derived state (around line 187, before `export const activeFile`), add:

```ts
import { buildTree, flattenVisible, type TreeNode } from './tree';

export const claudeCommentedPaths = createMemo(() => {
  const set = new Set<string>();
  for (const c of comments.list) {
    if (c?.author === 'claude' && c.file && !c.parentId && c.status !== 'dismissed') {
      set.add(c.file);
    }
  }
  return set;
});

export const [filterQuery, setFilterQuery] = createSignal('');

export const tree = createMemo<TreeNode[]>(() =>
  buildTree(files(), analysis(), {
    sort: sortMode(),
    group: analysis() ? groupMode() : 'none',
    claudeCommentedPaths: claudeCommentedPaths(),
  }),
);

export const visibleRows = createMemo<TreeNode[]>(() => {
  const dfSet = new Set(Object.keys(dismissedFiles).filter((k) => dismissedFiles[k]));
  const dfoSet = new Set(Object.keys(dismissedFolders).filter((k) => dismissedFolders[k]));
  return flattenVisible(tree(), {
    collapsedFolders: { ...collapsedFolders },
    dismissedFolders: dfoSet,
    dismissedFiles: dfSet,
    filterQuery: filterQuery(),
  });
});
```

Note the `import` line goes at the top of the file with the other imports.

- [ ] **Step 2: Replace the `activeFile` memo**

Replace line 189 (`export const activeFile = createMemo(() => files()[activeFileIdx()]);`) with:

```ts
export const activeFile = createMemo(() => {
  const rowId = activeRowId();
  if (!rowId) return undefined;
  for (const row of visibleRows()) {
    if (row.kind === 'file' && row.id === rowId) return row.file;
  }
  return undefined;
});
```

- [ ] **Step 3: Keep `activeFileIdx` as a temporary derived shim**

Replace `export const [activeFileIdx, setActiveFileIdx] = createSignal(0);` (line 79) with:

```ts
// Legacy index-based selection — derived from activeRowId during migration.
// TODO: remove once all consumers use activeFile()/activeRowId().
export const activeFileIdx = createMemo(() => {
  const f = activeFile();
  if (!f) return 0;
  const idx = files().findIndex((file) => file.path === f.path);
  return idx >= 0 ? idx : 0;
});

export function setActiveFileIdx(idx: number) {
  const f = files()[idx];
  if (f) setActiveRowId(f.path);
  else setActiveRowId(null);
}
```

- [ ] **Step 4: Run build**

Run: `npm run build:frontend`
Expected: passes. Some consumers still call `setActiveFileIdx(n)` — they'll work via the shim.

- [ ] **Step 5: Run frontend tests**

Run: `npm run test:frontend`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/state.ts
git commit -m "state: route activeFile through activeRowId with backward-compat index shim"
```

---

## Task 10: Update api.ts for sidebar-prefs endpoint

**Files:**
- Modify: `frontend/src/api.ts:28-31`, `:170-176`

- [ ] **Step 1: Update `UserState` interface**

Replace lines 28-31 of `frontend/src/api.ts`:

```ts
interface UserState {
  reviewedFiles: string[];
  sidebarView: string;
}
```

with:

```ts
export interface SidebarPrefs {
  sortMode: 'path' | 'priority';
  groupMode: 'none' | 'phase';
  groupModeUserTouched: boolean;
  collapsedFolders: Record<string, boolean>;
}

interface UserState extends SidebarPrefs {
  reviewedFiles: string[];
}
```

- [ ] **Step 2: Replace `putUserSidebarView`**

Replace lines 170-176 (the `putUserSidebarView` function) with:

```ts
export async function putUserSidebarPrefs(prefs: Partial<SidebarPrefs>): Promise<void> {
  await fetch(`${baseUrl()}/user-state/sidebar-prefs`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
}
```

- [ ] **Step 3: Run build**

Run: `npm run build:frontend`
Expected: will fail at `persistence.ts` (still imports `putUserSidebarView`). That's expected — Task 11 fixes it.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.ts
git commit -m "api: replace putUserSidebarView with putUserSidebarPrefs"
```

---

## Task 11: Rewrite persistence.ts

**Files:**
- Modify: `frontend/src/persistence.ts` (full rewrite)

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `frontend/src/persistence.ts` with:

```ts
import {
  reviewedFiles,
  setReviewedFiles,
  sortMode,
  setSortMode,
  groupMode,
  setGroupMode,
  groupModeUserTouched,
  setGroupModeUserTouched,
  collapsedFolders,
  setCollapsedFolders,
  analysis,
} from './state';
import { fetchUserState, putUserReviewed, putUserSidebarPrefs, type SidebarPrefs } from './api';

let lastReviewedSnapshot: Record<string, boolean> = {};
let lastPrefsSnapshot: SidebarPrefs = {
  sortMode: 'path',
  groupMode: 'none',
  groupModeUserTouched: false,
  collapsedFolders: {},
};

export async function loadState(): Promise<void> {
  try {
    const state = await fetchUserState();

    if (Array.isArray(state.reviewedFiles)) {
      for (const path of state.reviewedFiles) {
        setReviewedFiles(path, true);
      }
    }

    if (state.sortMode === 'path' || state.sortMode === 'priority') {
      setSortMode(state.sortMode);
    }
    if (state.groupMode === 'none' || state.groupMode === 'phase') {
      setGroupMode(state.groupMode);
    }
    if (typeof state.groupModeUserTouched === 'boolean') {
      setGroupModeUserTouched(state.groupModeUserTouched);
    }
    if (state.collapsedFolders && typeof state.collapsedFolders === 'object') {
      for (const [path, collapsed] of Object.entries(state.collapsedFolders)) {
        if (collapsed) setCollapsedFolders(path, true);
      }
    }

    // Analysis-driven default promotion: if analysis is present and user hasn't touched
    // groupMode, promote to 'phase'. Done after load so persisted values win.
    if (analysis() && !groupModeUserTouched() && groupMode() === 'none') {
      setGroupMode('phase');
    }

    lastReviewedSnapshot = { ...reviewedFiles };
    lastPrefsSnapshot = snapshotPrefs();
  } catch {
    /* server unavailable — start fresh */
  }
}

function snapshotPrefs(): SidebarPrefs {
  return {
    sortMode: sortMode(),
    groupMode: groupMode(),
    groupModeUserTouched: groupModeUserTouched(),
    collapsedFolders: { ...collapsedFolders },
  };
}

export function saveState(): void {
  // Reviewed files diff
  for (const path of Object.keys(reviewedFiles)) {
    if (reviewedFiles[path] && !lastReviewedSnapshot[path]) {
      putUserReviewed(path);
    }
  }
  for (const path of Object.keys(lastReviewedSnapshot)) {
    if (lastReviewedSnapshot[path] && !reviewedFiles[path]) {
      putUserReviewed(path);
    }
  }
  lastReviewedSnapshot = { ...reviewedFiles };

  // Prefs diff — send each field that changed.
  const next = snapshotPrefs();
  const changed: Partial<SidebarPrefs> = {};
  if (next.sortMode !== lastPrefsSnapshot.sortMode) changed.sortMode = next.sortMode;
  if (next.groupMode !== lastPrefsSnapshot.groupMode) changed.groupMode = next.groupMode;
  if (next.groupModeUserTouched !== lastPrefsSnapshot.groupModeUserTouched) {
    changed.groupModeUserTouched = next.groupModeUserTouched;
  }
  if (!shallowEqual(next.collapsedFolders, lastPrefsSnapshot.collapsedFolders)) {
    changed.collapsedFolders = next.collapsedFolders;
  }
  if (Object.keys(changed).length > 0) {
    putUserSidebarPrefs(changed);
    lastPrefsSnapshot = next;
  }
}

function shallowEqual(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

export async function clearPersistedState(): Promise<void> {
  lastReviewedSnapshot = {};
  const { baseUrl } = await import('./api');
  await fetch(`${baseUrl()}/user-state/clear`, { method: 'POST' });
}
```

- [ ] **Step 2: Wire saveState to fire on relevant signal changes**

In `frontend/src/persistence.ts`, at the very end, add:

```ts
import { createEffect } from 'solid-js';

export function watchAndSave(): void {
  createEffect(() => {
    // Subscribe to signals; saveState will no-op if nothing changed.
    sortMode();
    groupMode();
    groupModeUserTouched();
    // Access the store reactively by listing entries.
    Object.keys(collapsedFolders);
    Object.values(collapsedFolders);
    saveState();
  });
}
```

(Note: the `collapsedFolders` reactivity requires subscribing to the store. `Object.keys`/`Object.values` on a Solid store triggers the proxy tracking; alternative is a direct `createEffect` over the store's serialized form if this proves flaky.)

- [ ] **Step 3: Call `watchAndSave` from `ProjectView.tsx`**

In `frontend/src/ProjectView.tsx`, after `await loadState();` inside `onMount` (line 286), add:

```ts
    watchAndSave();
```

And update the import at the top (line 42):

```ts
import { loadState, clearPersistedState, watchAndSave } from './persistence';
```

- [ ] **Step 4: Run build**

Run: `npm run build:frontend`
Expected: passes.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: passes (existing behavior unchanged; new state isn't consumed yet).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/persistence.ts frontend/src/ProjectView.tsx
git commit -m "persistence: round-trip sidebar prefs against new endpoint with effect-driven save"
```

---

## Task 12: Migrate direct `activeFileIdx` / `files()[activeFileIdx()]` readers

**Files:**
- Modify: `frontend/src/components/diff/DiffView.tsx:2`, `:23`
- Modify: `frontend/src/components/diff/WholeFileView.tsx:2`, `:9`
- Modify: `frontend/src/hooks/useKeyboardShortcuts.ts:4-7`, `:86-89`

- [ ] **Step 1: DiffView — use `activeFile()`**

In `frontend/src/components/diff/DiffView.tsx`:

Replace line 2:

```ts
import { files, activeFileIdx, analysis, wholeFileView, toggleWholeFileView } from '../../state';
```

with:

```ts
import { activeFile, analysis, wholeFileView, toggleWholeFileView } from '../../state';
```

Replace line 23:

```ts
  const file = createMemo(() => files()[activeFileIdx()]);
```

with:

```ts
  const file = activeFile;
```

- [ ] **Step 2: WholeFileView — use `activeFile()`**

In `frontend/src/components/diff/WholeFileView.tsx`:

Replace line 2:

```ts
import { files, activeFileIdx, toggleWholeFileView } from '../../state';
```

with:

```ts
import { activeFile, toggleWholeFileView } from '../../state';
```

Replace line 9:

```ts
  const file = createMemo(() => files()[activeFileIdx()]);
```

with:

```ts
  const file = activeFile;
```

- [ ] **Step 3: useKeyboardShortcuts — route `e` and `w` through `activeFile()`**

In `frontend/src/hooks/useKeyboardShortcuts.ts`:

Replace lines 2-11:

```ts
import {
  appMode,
  files,
  activeFileIdx,
  setActiveFileIdx,
  setWholeFileView,
  toggleWholeFileView,
  allCommits,
  toggleReviewed,
} from '../state';
```

with:

```ts
import {
  appMode,
  activeFile,
  allCommits,
  toggleReviewed,
  toggleWholeFileView,
} from '../state';
```

Replace the `e` handler (lines 85-87):

```ts
    } else if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
      const file = files()[activeFileIdx()];
      if (file) toggleReviewed(file.path);
```

with:

```ts
    } else if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
      const f = activeFile();
      if (f) toggleReviewed(f.path);
```

Replace the `w` handler (lines 88-91):

```ts
    } else if (e.key === 'w' && !e.metaKey && !e.ctrlKey) {
      if (appMode() === 'diff' && files()[activeFileIdx()]) {
        toggleWholeFileView();
      }
```

with:

```ts
    } else if (e.key === 'w' && !e.metaKey && !e.ctrlKey) {
      if (appMode() === 'diff' && activeFile()) {
        toggleWholeFileView();
      }
```

**Do NOT touch the `j`/`k` handlers yet** — those are rewritten in Task 20.

- [ ] **Step 4: Run build + tests**

Run: `npm run build:frontend && npm run test:frontend`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/diff/DiffView.tsx frontend/src/components/diff/WholeFileView.tsx frontend/src/hooks/useKeyboardShortcuts.ts
git commit -m "diff/keyboard: route activeFileIdx readers through activeFile() memo"
```

---

## Task 13: Update ProjectView hash sync + itemState cache

**Files:**
- Modify: `frontend/src/ProjectView.tsx:2-27`, `:63-82`, `:114-120`, `:220`, `:330-341`

- [ ] **Step 1: Update imports**

In `frontend/src/ProjectView.tsx` replace the state imports block (lines 2-27) with:

```ts
import {
  files,
  activeFile,
  activeRowId,
  setActiveRowId,
  activeItemId,
  setActiveItemId,
  appMode,
  setAppMode,
  setFiles,
  setRepoMeta,
  setMdMeta,
  setAllCommits,
  setComments,
  replaceComments,
  setAnalysis,
  setWholeFileView,
  comments,
  sessionItems,
  setSessionItems,
  selectedShas,
  setSelectedShas,
  repoMeta,
  allCommits,
  paletteOpen,
  setPaletteOpen,
  collapsedFolders,
  setCollapsedFolders,
  dismissedFolders,
  setDismissedFoldersStore,
  filterQuery,
} from './state';
```

- [ ] **Step 2: Update per-item state cache to use file path**

Replace the `itemState` block (lines 63-82):

```ts
  // Per-item state: remembers file index and scroll position per tab
  const itemState = new Map<string, { fileIdx: number; scrollTop: number }>();

  function saveCurrentItemState() {
    const id = activeItemId();
    const container = document.getElementById('diff-container');
    itemState.set(id, {
      fileIdx: activeFileIdx(),
      scrollTop: container?.scrollTop ?? 0,
    });
  }

  function restoreItemState(itemId: string) {
    const saved = itemState.get(itemId);
    if (saved) {
      requestAnimationFrame(() => {
        const container = document.getElementById('diff-container');
        if (container) container.scrollTop = saved.scrollTop;
      });
    }
  }
```

with:

```ts
  // Per-item state: remembers active file path and scroll position per tab
  const itemState = new Map<string, { filePath: string | null; scrollTop: number }>();

  function saveCurrentItemState() {
    const id = activeItemId();
    const container = document.getElementById('diff-container');
    itemState.set(id, {
      filePath: activeFile()?.path ?? null,
      scrollTop: container?.scrollTop ?? 0,
    });
  }

  function restoreItemState(itemId: string) {
    const saved = itemState.get(itemId);
    if (saved) {
      requestAnimationFrame(() => {
        const container = document.getElementById('diff-container');
        if (container) container.scrollTop = saved.scrollTop;
      });
    }
  }
```

- [ ] **Step 3: Update `switchToItem` file-restoration block**

Replace lines 114-120 (the block right after `setFiles(parseDiff(data.diff));`):

```ts
      const saved = itemState.get(itemId);
      if (saved && saved.fileIdx < files().length) {
        setActiveFileIdx(saved.fileIdx);
      } else if (files().length > 0 && activeFileIdx() >= files().length) {
        setActiveFileIdx(0);
      }
      setWholeFileView(false);
```

with:

```ts
      const saved = itemState.get(itemId);
      const restoredPath = saved?.filePath;
      const f = restoredPath ? files().find((x) => x.path === restoredPath) : undefined;
      if (f) {
        setActiveRowId(f.path);
      } else if (files().length > 0) {
        setActiveRowId(files()[0].path);
      } else {
        setActiveRowId(null);
      }
      setWholeFileView(false);
```

- [ ] **Step 4: Update `handleApplyCommits` fallback**

Replace line 220 (`if (activeFileIdx() >= files().length) setActiveFileIdx(0);`) with:

```ts
      if (!activeFile() && files().length > 0) setActiveRowId(files()[0].path);
```

- [ ] **Step 5: Rewrite hash-navigation listener**

Replace the block at lines 330-341:

```ts
  // --- Hash navigation ---

  window.addEventListener('hashchange', () => {
    const match = window.location.hash.match(/#file=(.+)/);
    if (!match) return;
    const path = decodeURIComponent(match[1]);
    const idx = files().findIndex((f) => f.path === path);
    if (idx >= 0 && idx !== activeFileIdx()) {
      setActiveFileIdx(idx);
      setWholeFileView(false);
    }
  });
```

with:

```ts
  // --- Hash navigation ---

  function navigateToHashFile() {
    const match = window.location.hash.match(/#file=(.+)/);
    if (!match) return;
    const path = decodeURIComponent(match[1]);
    const f = files().find((x) => x.path === path);
    if (!f) return;

    // Force-expand every ancestor folder so the file is visible.
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const ancestor = segments.slice(0, i).join('/') + '/';
      if (collapsedFolders[ancestor]) setCollapsedFolders(ancestor, false);
      if (dismissedFolders[ancestor]) setDismissedFoldersStore(ancestor, false);
    }

    if (activeFile()?.path !== path) {
      setActiveRowId(path);
      setWholeFileView(false);
    }
  }

  window.addEventListener('hashchange', navigateToHashFile);
```

- [ ] **Step 6: Build and test**

Run: `npm run build:frontend && npm run test:frontend`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/ProjectView.tsx
git commit -m "ProjectView: use activeRowId for selection, path-keyed itemState, hash-force-expand"
```

---

## Task 14: `TreeFile` component

**Files:**
- Create: `frontend/src/components/sidebar/TreeFile.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/sidebar/TreeFile.tsx`:

```tsx
import { Show, createMemo } from 'solid-js';
import type { FileNode } from '../../tree';
import {
  activeRowId,
  setActiveRowId,
  setWholeFileView,
  comments,
  reviewedFiles,
  toggleReviewed,
  analysis,
  dismissFile,
} from '../../state';

interface Props {
  node: FileNode;
}

export default function TreeFile(props: Props) {
  const isActive = () => activeRowId() === props.node.id;
  const path = () => props.node.file.path;
  const isReviewed = () => reviewedFiles[path()] ?? false;

  const fileComments = createMemo(() =>
    comments.list.filter((c) => c.file === path() && !c.parentId && c.status !== 'dismissed'),
  );
  const userCount = () => fileComments().filter((c) => c.author === 'user').length;
  const claudeCount = () => fileComments().filter((c) => c.author === 'claude').length;

  const lastSlash = () => path().lastIndexOf('/');
  const base = () => (lastSlash() >= 0 ? path().slice(lastSlash() + 1) : path());
  const priority = () => analysis()?.files[path()]?.priority;

  function handleSelect() {
    setActiveRowId(props.node.id);
    setWholeFileView(false);
    window.location.hash = 'file=' + encodeURIComponent(path());
  }

  return (
    <div
      class={`file-item${isActive() ? ' active' : ''}${isReviewed() ? ' reviewed' : ''}${priority() ? ` priority-${priority()}` : ''}`}
      data-id={props.node.id}
      style={{ 'padding-left': `${props.node.depth * 12 + 8}px` }}
      role="treeitem"
      aria-level={props.node.depth + 1}
      aria-selected={isActive()}
      onClick={handleSelect}
    >
      <span
        class="review-check"
        title="Mark as reviewed (e)"
        onClick={(e) => {
          e.stopPropagation();
          toggleReviewed(path());
        }}
      >
        {isReviewed() ? '✓' : '○'}
      </span>
      <span class="filename" title={path()}>
        <span class="base">{base()}</span>
      </span>
      <Show when={claudeCount() > 0}>
        <span class="badge claude-badge" title="Claude comments">
          {claudeCount()}
        </span>
      </Show>
      <Show when={userCount() > 0}>
        <span class="badge comments-badge" title="Your comments">
          {userCount()}
        </span>
      </Show>
      <span class="file-stats">
        <span class="add">+{props.node.file.additions}</span>
        <span class="del">-{props.node.file.deletions}</span>
      </span>
      <span
        class="file-dismiss"
        title="Hide file"
        onClick={(e) => {
          e.stopPropagation();
          dismissFile(path());
        }}
      >
        &times;
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Run build**

Run: `npm run build:frontend`
Expected: passes. Component is not yet wired in — just ensure it compiles.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/sidebar/TreeFile.tsx
git commit -m "sidebar: TreeFile component — file row with review, badges, stats, dismiss"
```

---

## Task 15: `TreeFolder` component

**Files:**
- Create: `frontend/src/components/sidebar/TreeFolder.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/sidebar/TreeFolder.tsx`:

```tsx
import { Show, createMemo } from 'solid-js';
import type { FolderNode, FileNode } from '../../tree';
import {
  activeRowId,
  setActiveRowId,
  collapsedFolders,
  toggleFolderCollapsed,
  dismissFolder,
  reviewedFiles,
} from '../../state';

interface Props {
  node: FolderNode;
}

function collectFiles(node: FolderNode, out: FileNode[]): void {
  for (const child of node.children) {
    if (child.kind === 'file') out.push(child);
    else collectFiles(child, out);
  }
}

export default function TreeFolder(props: Props) {
  const isActive = () => activeRowId() === props.node.id;
  const isSynthPhaseRoot = () => props.node.fullPath.endsWith(':__root__');
  const collapsed = () => !!collapsedFolders[props.node.fullPath];

  const descendants = createMemo(() => {
    const out: FileNode[] = [];
    collectFiles(props.node, out);
    return out;
  });

  const total = () => descendants().length;
  const reviewedCount = () => descendants().filter((f) => reviewedFiles[f.file.path]).length;
  const allReviewed = () => total() > 0 && reviewedCount() === total();

  function handleClick() {
    setActiveRowId(props.node.id);
    toggleFolderCollapsed(props.node.fullPath);
  }

  function handleDismiss(e: MouseEvent) {
    e.stopPropagation();
    dismissFolder(props.node.fullPath);
  }

  return (
    <div
      class={`folder-item${isActive() ? ' active' : ''}${allReviewed() ? ' all-reviewed' : ''}${isSynthPhaseRoot() ? ' phase-root' : ''}`}
      data-id={props.node.id}
      style={{ 'padding-left': `${props.node.depth * 12 + 4}px` }}
      role="treeitem"
      aria-level={props.node.depth + 1}
      aria-expanded={!collapsed()}
      aria-selected={isActive()}
      onClick={handleClick}
    >
      <span class="folder-chevron">{collapsed() ? '▸' : '▾'}</span>
      <span class="folder-name">{props.node.name}</span>
      <Show when={total() > 0}>
        <span
          class="folder-progress"
          aria-label={`${reviewedCount()} of ${total()} files reviewed`}
        >
          {reviewedCount()}/{total()}
        </span>
      </Show>
      <Show when={!isSynthPhaseRoot()}>
        <span
          class="folder-dismiss"
          title="Hide folder"
          onClick={handleDismiss}
        >
          &times;
        </span>
      </Show>
    </div>
  );
}
```

- [ ] **Step 2: Run build**

Run: `npm run build:frontend`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/sidebar/TreeFolder.tsx
git commit -m "sidebar: TreeFolder component — chevron, name, progress, dismiss"
```

---

## Task 16: `SortGroupControls` component

**Files:**
- Create: `frontend/src/components/sidebar/SortGroupControls.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/sidebar/SortGroupControls.tsx`:

```tsx
import { Show } from 'solid-js';
import {
  analysis,
  sortMode,
  setSortMode,
  groupMode,
  setGroupMode,
  setGroupModeUserTouched,
} from '../../state';

export default function SortGroupControls() {
  function pickSort(mode: 'path' | 'priority') {
    setSortMode(mode);
  }
  function pickGroup(mode: 'none' | 'phase') {
    setGroupMode(mode);
    setGroupModeUserTouched(true);
  }

  return (
    <Show when={analysis()}>
      <div class="sort-group-controls">
        <div class="chip-row">
          <span class="chip-label">Sort:</span>
          <button
            class="chip"
            classList={{ on: sortMode() === 'path' }}
            onClick={() => pickSort('path')}
          >
            Path
          </button>
          <button
            class="chip"
            classList={{ on: sortMode() === 'priority' }}
            onClick={() => pickSort('priority')}
          >
            Priority
          </button>
        </div>
        <div class="chip-row">
          <span class="chip-label">Group by:</span>
          <button
            class="chip"
            classList={{ on: groupMode() === 'none' }}
            onClick={() => pickGroup('none')}
          >
            None
          </button>
          <button
            class="chip"
            classList={{ on: groupMode() === 'phase' }}
            onClick={() => pickGroup('phase')}
          >
            Phase
          </button>
        </div>
      </div>
    </Show>
  );
}
```

- [ ] **Step 2: Run build**

Run: `npm run build:frontend`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/sidebar/SortGroupControls.tsx
git commit -m "sidebar: SortGroupControls component with Path/Priority and None/Phase chips"
```

---

## Task 17: `FileTree` component

**Files:**
- Create: `frontend/src/components/sidebar/FileTree.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/sidebar/FileTree.tsx`:

```tsx
import { For, Show } from 'solid-js';
import {
  visibleRows,
  files,
  dismissedFiles,
  dismissedFolders,
  undismissAll,
  filterQuery,
} from '../../state';
import TreeFile from './TreeFile';
import TreeFolder from './TreeFolder';

export default function FileTree() {
  const hasAnyDismissed = () =>
    Object.values(dismissedFiles).some(Boolean) || Object.values(dismissedFolders).some(Boolean);

  const dismissedTotal = () =>
    Object.values(dismissedFiles).filter(Boolean).length +
    Object.values(dismissedFolders).filter(Boolean).length;

  const hasFiles = () => files().length > 0;
  const rowsExist = () => visibleRows().length > 0;
  const filtering = () => filterQuery().trim().length > 0;

  return (
    <div class="file-tree" id="file-tree" role="tree">
      <Show when={hasAnyDismissed()}>
        <div class="dismissed-notice">
          <a onClick={undismissAll}>
            {dismissedTotal()} hidden item{dismissedTotal() !== 1 ? 's' : ''} — show all
          </a>
        </div>
      </Show>
      <For each={visibleRows()}>
        {(row) =>
          row.kind === 'file' ? <TreeFile node={row} /> : <TreeFolder node={row} />
        }
      </For>
      <Show when={hasFiles() && !rowsExist() && filtering()}>
        <div class="tree-empty">No matches</div>
      </Show>
    </div>
  );
}
```

- [ ] **Step 2: Run build**

Run: `npm run build:frontend`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/sidebar/FileTree.tsx
git commit -m "sidebar: FileTree composes visible rows + dismiss banner + empty-matches"
```

---

## Task 18: Swap Sidebar.tsx; delete FileList + ViewToggle

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.tsx`
- Modify: `frontend/src/components/sidebar/FileSearch.tsx`
- Delete: `frontend/src/components/sidebar/FileList.tsx`
- Delete: `frontend/src/components/sidebar/ViewToggle.tsx`

- [ ] **Step 1: Update `FileSearch` to use the shared `filterQuery` signal**

Replace `frontend/src/components/sidebar/FileSearch.tsx` with:

```tsx
import { filterQuery, setFilterQuery } from '../../state';

export default function FileSearch() {
  let inputRef!: HTMLInputElement;

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      inputRef.value = '';
      setFilterQuery('');
      inputRef.blur();
    } else if (e.key === 'Enter') {
      inputRef.blur();
    }
  }

  // Expose focus for the `f` keyboard shortcut.
  (window as any).__focusFileSearch = () => inputRef?.focus();

  return (
    <div class="sidebar-search">
      <input
        ref={inputRef}
        type="text"
        id="file-search"
        placeholder="Filter files... (f)"
        autocomplete="off"
        value={filterQuery()}
        onInput={(e) => setFilterQuery(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
```

- [ ] **Step 2: Replace `Sidebar.tsx`**

Replace `frontend/src/components/sidebar/Sidebar.tsx` with:

```tsx
import FileSearch from './FileSearch';
import SortGroupControls from './SortGroupControls';
import FileTree from './FileTree';

export default function Sidebar() {
  return (
    <div class="sidebar">
      <div class="sidebar-controls">
        <FileSearch />
        <SortGroupControls />
      </div>
      <FileTree />
    </div>
  );
}
```

- [ ] **Step 3: Delete old components**

```bash
rm frontend/src/components/sidebar/FileList.tsx
rm frontend/src/components/sidebar/ViewToggle.tsx
```

- [ ] **Step 4: Remove `sidebarView` / `SidebarView` from state.ts**

In `frontend/src/state.ts`:

Delete the line `export type SidebarView = 'flat' | 'grouped' | 'phased';` (around line 71).

Delete the line `export const [sidebarView, setSidebarView] = createSignal<SidebarView>('flat');` (around line 83).

- [ ] **Step 5: Run build**

Run: `npm run build:frontend`
Expected: passes (all consumers of the deleted signal have been removed).

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/sidebar/Sidebar.tsx frontend/src/components/sidebar/FileSearch.tsx frontend/src/state.ts
git rm frontend/src/components/sidebar/FileList.tsx frontend/src/components/sidebar/ViewToggle.tsx
git commit -m "sidebar: replace shell with tree; delete FileList, ViewToggle, sidebarView signal"
```

---

## Task 19: Remove the legacy `activeFileIdx` shim once unused

**Files:**
- Modify: `frontend/src/state.ts`

- [ ] **Step 1: Verify no remaining callers**

Run:

```bash
grep -rn "activeFileIdx\|setActiveFileIdx" frontend/src/ || echo "no-matches"
```

Expected: only matches in `state.ts` itself (the shim definition and its internal use, if any). If any other file still references it, stop and route that caller through `activeFile()` before continuing.

- [ ] **Step 2: Remove the shim**

In `frontend/src/state.ts`, delete the block added in Task 9 step 3:

```ts
// Legacy index-based selection — derived from activeRowId during migration.
// TODO: remove once all consumers use activeFile()/activeRowId().
export const activeFileIdx = createMemo(() => { ... });

export function setActiveFileIdx(idx: number) { ... }
```

- [ ] **Step 3: Run build + tests**

Run: `npm run build:frontend && npm test`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/state.ts
git commit -m "state: drop activeFileIdx shim; activeRowId is the sole selection anchor"
```

---

## Task 20: Tree keyboard navigation

**Files:**
- Modify: `frontend/src/hooks/useKeyboardShortcuts.ts`
- Create: `frontend/src/__tests__/sidebar-keyboard.test.ts`

- [ ] **Step 1: Write failing tests for the keyboard helpers**

Create `frontend/src/__tests__/sidebar-keyboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  nextRow,
  prevRow,
  nextFolder,
  prevFolder,
  folderOf,
} from '../hooks/useKeyboardShortcuts-helpers';
import type { TreeNode } from '../tree';

function folder(id: string, depth: number): TreeNode {
  return { kind: 'folder', id, name: id, fullPath: id, depth, children: [] } as TreeNode;
}
function file(id: string, depth: number): TreeNode {
  return { kind: 'file', id, file: { path: id, additions: 0, deletions: 0, lines: [] }, depth } as TreeNode;
}

describe('keyboard helpers', () => {
  const rows: TreeNode[] = [
    folder('a/', 0),
    file('a/x.ts', 1),
    file('a/y.ts', 1),
    folder('b/', 0),
    file('b/z.ts', 1),
  ];

  it('nextRow moves through files and folders in order', () => {
    expect(nextRow(rows, 'a/')).toBe('a/x.ts');
    expect(nextRow(rows, 'a/x.ts')).toBe('a/y.ts');
    expect(nextRow(rows, 'a/y.ts')).toBe('b/');
    expect(nextRow(rows, 'b/z.ts')).toBeNull();
  });

  it('prevRow goes back across folders and files', () => {
    expect(prevRow(rows, 'a/x.ts')).toBe('a/');
    expect(prevRow(rows, 'a/')).toBeNull();
    expect(prevRow(rows, 'b/')).toBe('a/y.ts');
  });

  it('nextFolder / prevFolder jump between folder rows', () => {
    expect(nextFolder(rows, 'a/')).toBe('b/');
    expect(nextFolder(rows, 'a/x.ts')).toBe('b/');
    expect(nextFolder(rows, 'b/z.ts')).toBeNull();
    expect(prevFolder(rows, 'b/z.ts')).toBe('b/');
    expect(prevFolder(rows, 'b/')).toBe('a/');
  });

  it('folderOf returns the parent folder row id for a file', () => {
    expect(folderOf(rows, 'a/x.ts')).toBe('a/');
    expect(folderOf(rows, 'b/z.ts')).toBe('b/');
    expect(folderOf(rows, 'a/')).toBe('a/'); // folder itself
  });
});
```

- [ ] **Step 2: Create helpers module**

Create `frontend/src/hooks/useKeyboardShortcuts-helpers.ts`:

```ts
import type { TreeNode } from '../tree';

export function nextRow(rows: TreeNode[], currentId: string | null): string | null {
  if (!currentId) return rows[0]?.id ?? null;
  const i = rows.findIndex((r) => r.id === currentId);
  if (i < 0) return rows[0]?.id ?? null;
  return rows[i + 1]?.id ?? null;
}

export function prevRow(rows: TreeNode[], currentId: string | null): string | null {
  if (!currentId) return null;
  const i = rows.findIndex((r) => r.id === currentId);
  if (i <= 0) return null;
  return rows[i - 1].id;
}

export function nextFolder(rows: TreeNode[], currentId: string | null): string | null {
  const start = currentId ? rows.findIndex((r) => r.id === currentId) : -1;
  for (let i = start + 1; i < rows.length; i++) {
    if (rows[i].kind === 'folder') return rows[i].id;
  }
  return null;
}

export function prevFolder(rows: TreeNode[], currentId: string | null): string | null {
  const start = currentId ? rows.findIndex((r) => r.id === currentId) : rows.length;
  for (let i = start - 1; i >= 0; i--) {
    if (rows[i].kind === 'folder') return rows[i].id;
  }
  return null;
}

export function folderOf(rows: TreeNode[], currentId: string | null): string | null {
  if (!currentId) return null;
  const i = rows.findIndex((r) => r.id === currentId);
  if (i < 0) return null;
  if (rows[i].kind === 'folder') return rows[i].id;
  // Walk back to find the most recent row whose depth is less than this file's depth.
  const depth = rows[i].depth;
  for (let k = i - 1; k >= 0; k--) {
    if (rows[k].kind === 'folder' && rows[k].depth < depth) return rows[k].id;
  }
  return null;
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run frontend/src/__tests__/sidebar-keyboard.test.ts`
Expected: all cases pass.

- [ ] **Step 4: Rewrite `useKeyboardShortcuts` for tree nav**

Replace the entire body of `frontend/src/hooks/useKeyboardShortcuts.ts` with:

```ts
import { onMount, onCleanup } from 'solid-js';
import {
  appMode,
  activeFile,
  activeRowId,
  setActiveRowId,
  setWholeFileView,
  toggleWholeFileView,
  allCommits,
  toggleReviewed,
  visibleRows,
  collapsedFolders,
  setCollapsedFolders,
  toggleFolderCollapsed,
} from '../state';
import { nextRow, prevRow, nextFolder, prevFolder, folderOf } from './useKeyboardShortcuts-helpers';

interface Options {
  onRefresh: () => void;
  onToggleCommits: () => void;
  onJumpComment: (direction: 'next' | 'prev') => void;
  onSymbolSearch: () => void;
  onOpenPalette: () => void;
}

export function useKeyboardShortcuts(options: Options) {
  let lastShiftUp = 0;
  let shiftDownClean = false;

  function onKeyDown(e: KeyboardEvent) {
    shiftDownClean = e.key === 'Shift';
  }

  function onShiftUp(e: KeyboardEvent) {
    if (e.key !== 'Shift') return;
    if (!shiftDownClean) return;
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    const now = Date.now();
    if (now - lastShiftUp < 300) {
      lastShiftUp = 0;
      options.onSymbolSearch();
    } else {
      lastShiftUp = now;
    }
  }

  function moveTo(nextId: string | null) {
    if (!nextId) return;
    setActiveRowId(nextId);
    const rows = visibleRows();
    const row = rows.find((r) => r.id === nextId);
    if (row?.kind === 'file') {
      setWholeFileView(false);
      window.location.hash = 'file=' + encodeURIComponent(row.file.path);
    }
  }

  function handler(e: KeyboardEvent) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      options.onOpenPalette();
      return;
    }

    const rows = visibleRows();
    const cur = activeRowId();

    if (e.key === 'j' || e.key === 'ArrowDown') {
      moveTo(nextRow(rows, cur));
    } else if ((e.key === 'k' || e.key === 'ArrowUp') && !e.metaKey && !e.ctrlKey) {
      moveTo(prevRow(rows, cur));
    } else if (e.key === 'h' || e.key === 'ArrowLeft') {
      const row = rows.find((r) => r.id === cur);
      if (!row) return;
      if (row.kind === 'folder') {
        setCollapsedFolders(row.fullPath, true);
      } else {
        moveTo(folderOf(rows, cur));
      }
    } else if (e.key === 'l' || e.key === 'ArrowRight') {
      const row = rows.find((r) => r.id === cur);
      if (!row || row.kind !== 'folder') return;
      if (collapsedFolders[row.fullPath]) {
        setCollapsedFolders(row.fullPath, false);
      } else {
        // Move to first child (after expand it's the row right after this one).
        const newRows = visibleRows();
        const idx = newRows.findIndex((r) => r.id === row.id);
        const child = newRows[idx + 1];
        if (child && child.depth > row.depth) moveTo(child.id);
      }
    } else if (e.key === '[') {
      moveTo(prevFolder(rows, cur));
    } else if (e.key === ']') {
      moveTo(nextFolder(rows, cur));
    } else if (e.key === 'o' && !e.metaKey && !e.ctrlKey) {
      const parent = folderOf(rows, cur);
      if (parent) {
        const folderRow = rows.find((r) => r.id === parent);
        if (folderRow?.kind === 'folder') toggleFolderCollapsed(folderRow.fullPath);
      }
    } else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
      options.onRefresh();
    } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      (window as any).__focusFileSearch?.();
    } else if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
      if (allCommits().length > 0) options.onToggleCommits();
    } else if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
      const f = activeFile();
      if (f) toggleReviewed(f.path);
    } else if (e.key === 'w' && !e.metaKey && !e.ctrlKey) {
      if (appMode() === 'diff' && activeFile()) toggleWholeFileView();
    } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
      options.onJumpComment('next');
    } else if (e.key === 'p' && !e.metaKey && !e.ctrlKey) {
      options.onJumpComment('prev');
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handler);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onShiftUp);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', handler);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onShiftUp);
  });
}
```

- [ ] **Step 5: Run build + tests**

Run: `npm run build:frontend && npm test`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useKeyboardShortcuts.ts frontend/src/hooks/useKeyboardShortcuts-helpers.ts frontend/src/__tests__/sidebar-keyboard.test.ts
git commit -m "keyboard: tree navigation (j/k, h/l, [/], o) with helpers tests"
```

---

## Task 21: Folder auto-collapse when all reviewed

**Files:**
- Modify: `frontend/src/components/sidebar/TreeFolder.tsx`

- [ ] **Step 1: Add one-shot auto-collapse effect**

In `frontend/src/components/sidebar/TreeFolder.tsx`, add `createEffect` to the imports:

```tsx
import { Show, createMemo, createEffect } from 'solid-js';
```

Add imports for the collapse setter and add the effect at the top of `TreeFolder` (right after the memos, before `handleClick`):

```tsx
import { setCollapsedFolders } from '../../state';
// ... existing imports

export default function TreeFolder(props: Props) {
  // ... existing code up through `allReviewed`

  // One-shot auto-collapse: when this folder flips to "all reviewed", collapse it.
  // If the user re-opens it, `wasAllReviewed` stays true so we don't keep re-collapsing.
  let wasAllReviewed = false;
  createEffect(() => {
    const done = allReviewed();
    if (done && !wasAllReviewed) {
      wasAllReviewed = true;
      if (!collapsedFolders[props.node.fullPath]) {
        setCollapsedFolders(props.node.fullPath, true);
      }
    }
    if (!done) wasAllReviewed = false;
  });

  // ... existing handleClick, handleDismiss, return statement
```

- [ ] **Step 2: Build + test**

Run: `npm run build:frontend && npm test`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/sidebar/TreeFolder.tsx
git commit -m "sidebar: folders auto-collapse when all descendant files are reviewed (one-shot)"
```

---

## Task 22: CSS for tree + accessibility focus

**Files:**
- Modify: `frontend/src/style.css` (append new rules; keep existing `.file-item` styles intact for `TreeFile`)

- [ ] **Step 1: Append tree-specific styles**

Append to `frontend/src/style.css`:

```css
/* --- File tree --- */
.file-tree { overflow-y: auto; }
.file-tree:focus { outline: none; }

.folder-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  color: var(--text);
  border-left: 2px solid transparent;
}
.folder-item:hover { background: var(--hover); }
.folder-item.active { background: var(--active); border-left-color: var(--accent); }
.folder-item.phase-root { font-weight: 600; font-size: 12px; padding-top: 6px; padding-bottom: 4px; }
.folder-item.all-reviewed .folder-progress { color: var(--muted); opacity: 0.7; }

.folder-chevron { width: 10px; color: var(--muted); }
.folder-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.folder-progress { font-size: 10px; color: var(--muted); margin-left: auto; padding-left: 6px; }
.folder-dismiss {
  color: var(--muted);
  opacity: 0;
  padding: 0 4px;
  cursor: pointer;
}
.folder-item:hover .folder-dismiss { opacity: 1; }
.folder-dismiss:hover { color: var(--text); }

.sort-group-controls { display: flex; flex-direction: column; gap: 4px; padding: 4px 8px; border-bottom: 1px solid var(--border); }
.chip-row { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--muted); flex-wrap: wrap; }
.chip-label { text-transform: uppercase; letter-spacing: 0.5px; }
.chip {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--muted);
  font-size: 10px;
  cursor: pointer;
}
.chip:hover { color: var(--text); }
.chip.on { background: var(--accent-fade, rgba(88,166,255,0.2)); color: var(--accent); border-color: var(--accent); }

.tree-empty { padding: 12px; color: var(--muted); font-size: 12px; text-align: center; }
```

- [ ] **Step 2: Build + test**

Run: `npm run build:frontend && npm test`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css
git commit -m "css: styles for tree folder rows, chip controls, empty-matches state"
```

---

## Task 23: Full verification + manual smoke test

**Files:** none

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests pass (server + frontend).

- [ ] **Step 2: Run lint + format check**

Run: `npm run lint && npm run format:check`
Expected: passes. Fix any new violations inline.

- [ ] **Step 3: Run full build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 4: Manual smoke**

Start the dev environment:

```bash
npm run dev:all
```

Open the app, then exercise:

1. Open a project with no analysis. Sidebar shows a plain tree; chip row is hidden.
2. Run the analysis (`/lgtm analyze` or prior data). Chip row appears; tree regroups into phase roots.
3. Toggle `Sort: Priority` — files within each folder reorder by priority.
4. Toggle `Group by: None` — phase roots collapse into a single tree.
5. `j`/`k` steps through folders + files; `h` on a file jumps to its folder row; `l` on a folder expands/descends; `[`/`]` jumps between folders; `o` toggles the containing folder; `e` marks reviewed; `f` focuses filter.
6. Type `sidebar/` in the filter — tree narrows to that subtree, collapsed folders auto-expand. Clear filter — persisted collapse restores.
7. Dismiss a folder via `×`. Subtree disappears. Banner says `N hidden items — show all`. Click — subtree returns.
8. Mark all files in a folder reviewed — folder auto-collapses with muted progress.
9. Reload page — sort/group/collapsed folders restore from server persistence.
10. Paste a `#file=path` URL into a new tab — ancestors force-expand; file is active.

If anything fails, create follow-up tasks in the plan rather than hacking fixes inline.

- [ ] **Step 5: Commit any dev-observed fixes** (if needed)

```bash
git add <files>
git commit -m "<fix>: <short description of the regression>"
```

- [ ] **Step 6: Merge-ready**

Branch is ready for PR. Suggested PR title: `Sidebar overhaul: composable directory tree with sort/group chips`.

---

## Self-review

- **Spec coverage:** Every spec section mapped: UX shape (Tasks 16-18), tree model (3-6), filter (7), folder affordances (15, 21), empty state (17), keyboard (20), state (8-9), persistence (1-2, 10-11), components (14-18), call-sites (12-13, 19), migration (1, 11, 18), testing (2, 3-7, 20). Behavior drops noted in spec — no code task needed.
- **Placeholder scan:** No TBDs, TODOs, or vague instructions. One `TODO:` *comment* in the shim during Task 9 is explicitly removed in Task 19 — that's deliberate scaffolding, not a placeholder.
- **Type consistency:** `TreeNode`/`FolderNode`/`FileNode` introduced in Task 3, extended consistently through Tasks 4-7 and consumed in 14-17. `SortMode`/`GroupMode`/`SidebarPrefs` introduced in Tasks 8 and 10, consumed in 11. `setActiveRowId`, `activeRowId`, `activeFile` used consistently from Task 9 onward. `setCollapsedFolders(key, value)` signature used consistently.
