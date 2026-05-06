# Iterative Analysis Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make analysis incremental — refreshing N changed files re-classifies only those N, with freshness tracking, server-side persistence as the source of truth, and a UI affordance to trigger refresh.

**Architecture:** Add a blob-SHA-pair freshness primitive (one `git diff --raw` invocation), augment the existing `_analysis` shape additively, add a `read_analysis` MCP tool plus a `mode: "merge"` parameter on `set_analysis`, broadcast a new `analysis_changed` SSE event, and add a `POST /refresh-analysis` REST route that uses the existing `notifyChannel` to send a human-initiated channel message.

**Tech Stack:** Node.js, TypeScript, Express, MCP (StreamableHTTP), better-sqlite3, vitest + supertest, SolidJS.

**Spec:** `docs/superpowers/specs/2026-05-06-iterative-analysis-design.md`

---

## File Structure

**Created:**
- `server/freshness.ts` — pure freshness computation: given current `git diff --raw` output and stored analysis, compute `staleFiles` / `missingFiles` / `removedFiles` / `staleSynthesis`.
- `server/__tests__/freshness.test.ts` — unit tests for the above.
- `skills/refresh/SKILL.md` — new `/lgtm refresh` skill.
- `frontend/src/api/refresh.ts` — small client module for `POST /refresh-analysis`, `GET /analysis/freshness`, `GET /connection-state`.
- `frontend/src/header/ConnectionIndicator.tsx` — header dot showing claimed/alive state.
- `frontend/src/header/RefreshButton.tsx` — refresh button + fallback affordance.

**Modified:**
- `server/git-ops.ts` — add `getBranchDiffRaw()` returning `Map<path, {oldBlob, newBlob, status}>`.
- `server/parse-analysis.ts` — extend `FileAnalysis` with optional freshness fields; preserve them through parse.
- `server/session.ts` — augment `_analysis` shape; add `mergeAnalysis()`, `getAnalysisWithFreshness()`, freshness cache.
- `server/mcp.ts` — add `read_analysis` tool; extend `set_analysis` with `mode` + `removedFiles`; introduce `ProjectClaim` record + `getProjectClaim()` helpers; broadcast `analysis_changed`.
- `server/app.ts` — augment `GET /analysis`; add `GET /analysis/freshness`, `GET /connection-state`, `POST /refresh-analysis`.
- `server/store.ts` — verify the analysis column round-trips the new shape (likely no change since it stores JSON).
- `agents/file-classifier/AGENT.md` — add delta-mode section.
- `skills/analyze/SKILL.md` — delegate to refresh when prior analysis exists.
- `frontend/src/state.ts` — extend `Analysis` interface; add `freshness` and `connectionState` signals.
- `frontend/src/ProjectView.tsx` — add `analysis_changed` SSE listener; refetch freshness on `git_changed`.
- `frontend/src/sidebar/FileList.tsx` — render per-file staleness badge.
- `frontend/src/header/AnalysisTab.tsx` (or wherever the analysis tab header lives) — render stale count chip.
- `frontend/src/style.css` — styles for staleness badge, connection dot, refresh button states.

---

## Phase 1 — Freshness primitive (server)

### Task 1: `getBranchDiffRaw()` git-ops helper

**Files:**
- Modify: `server/git-ops.ts`
- Test: `server/__tests__/git-ops.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/git-ops.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { getBranchDiffRaw } from '../git-ops.js';

describe('getBranchDiffRaw', () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'lgtm-rawdiff-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(join(repo, 'kept.txt'), 'unchanged\n');
    writeFileSync(join(repo, 'removed.txt'), 'will be removed\n');
    writeFileSync(join(repo, 'modified.txt'), 'old\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(join(repo, 'modified.txt'), 'new\n');
    writeFileSync(join(repo, 'added.txt'), 'fresh file\n');
    execFileSync('rm', [join(repo, 'removed.txt')]);
    git('add', '-A');
    git('commit', '-q', '-m', 'feature work');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('returns a map of path -> {oldBlob, newBlob, status} for branch changes', () => {
    const result = getBranchDiffRaw(repo, 'master');
    expect(result.has('modified.txt')).toBe(true);
    const m = result.get('modified.txt')!;
    expect(m.status).toBe('M');
    expect(m.oldBlob).toMatch(/^[0-9a-f]{40}$/);
    expect(m.newBlob).toMatch(/^[0-9a-f]{40}$/);
    expect(m.oldBlob).not.toBe(m.newBlob);
  });

  it('marks added files with zero old-blob', () => {
    const result = getBranchDiffRaw(repo, 'master');
    const a = result.get('added.txt')!;
    expect(a.status).toBe('A');
    expect(a.oldBlob).toBe('0000000000000000000000000000000000000000');
  });

  it('marks deleted files with zero new-blob', () => {
    const result = getBranchDiffRaw(repo, 'master');
    const d = result.get('removed.txt')!;
    expect(d.status).toBe('D');
    expect(d.newBlob).toBe('0000000000000000000000000000000000000000');
  });

  it('omits files unchanged on the branch', () => {
    const result = getBranchDiffRaw(repo, 'master');
    expect(result.has('kept.txt')).toBe(false);
  });
});
```

The base branch is `master` because `git init` defaults to it (override with `git init -b main` if your git version differs — adjust the test to match).

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/__tests__/git-ops.test.ts
```

Expected: FAIL — `getBranchDiffRaw` is not exported.

- [ ] **Step 3: Implement `getBranchDiffRaw`**

Add to `server/git-ops.ts` after `getBranchDiff`:

```typescript
export interface RawDiffEntry {
  oldBlob: string;
  newBlob: string;
  status: string; // 'A' | 'D' | 'M' | 'R...' | 'C...' | 'T'
}

/**
 * One-shot branch diff metadata: returns blob SHAs and status code per file.
 * Single git invocation — used to compute analysis freshness without N spawns.
 *
 * Output of `git diff --raw <base>...HEAD` is one line per file:
 *   :100644 100644 abc123 def456 M\tpath/to/file.ts
 *   :000000 100644 0000000... abc123 A\tnew/file.ts                 (added)
 *   :100644 000000 abc123 0000000... D\told/file.ts                 (deleted)
 *   :100644 100644 abc123 def456 R100\told/path\tnew/path           (rename)
 */
export function getBranchDiffRaw(repoPath: string, baseBranch: string): Map<string, RawDiffEntry> {
  const result = new Map<string, RawDiffEntry>();
  let output: string;
  try {
    output = gitRun(repoPath, 'diff', '--raw', `${baseBranch}...HEAD`);
  } catch {
    return result; // empty diff or invalid base
  }
  for (const line of output.split('\n')) {
    if (!line.startsWith(':')) continue;
    // Tab-separated metadata + path columns.
    // Metadata columns are space-separated:
    //   :oldMode newMode oldBlob newBlob STATUS
    const tabIdx = line.indexOf('\t');
    if (tabIdx < 0) continue;
    const metaCols = line.slice(1, tabIdx).split(' ');
    if (metaCols.length < 5) continue;
    const [, , oldBlob, newBlob, status] = metaCols;
    const pathCols = line.slice(tabIdx + 1).split('\t');
    // For renames, pathCols = [oldPath, newPath] — index analysis by newPath.
    // For all other statuses, pathCols = [path].
    const path = pathCols[pathCols.length - 1];
    result.set(path, { oldBlob, newBlob, status });
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/__tests__/git-ops.test.ts
```

Expected: PASS — all four cases.

- [ ] **Step 5: Commit**

```bash
git add server/git-ops.ts server/__tests__/git-ops.test.ts
git commit -m "feat(git-ops): add getBranchDiffRaw for blob-pair freshness"
```

---

## Phase 2 — Data model + freshness compute

### Task 2: Extend `FileAnalysis` with freshness fields (parser passthrough)

**Files:**
- Modify: `server/parse-analysis.ts:1-6`
- Test: `server/__tests__/parse-analysis.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/parse-analysis.test.ts`:

```typescript
it('FileAnalysis type accepts optional analyzedAtBaseBlob and analyzedAtHeadBlob', () => {
  // Compile-time check: this just needs to typecheck.
  const entry: import('../parse-analysis.js').FileAnalysis = {
    priority: 'normal',
    phase: 'review',
    summary: 's',
    category: 'c',
    analyzedAtBaseBlob: 'abc',
    analyzedAtHeadBlob: 'def',
  };
  expect(entry.analyzedAtBaseBlob).toBe('abc');
  expect(entry.analyzedAtHeadBlob).toBe('def');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/__tests__/parse-analysis.test.ts
```

Expected: FAIL — `Object literal may only specify known properties, and 'analyzedAtBaseBlob' does not exist...`

- [ ] **Step 3: Extend the interface**

In `server/parse-analysis.ts`, replace the `FileAnalysis` interface:

```typescript
export interface FileAnalysis {
  priority: 'critical' | 'important' | 'normal' | 'low';
  phase: 'review' | 'skim' | 'rubber-stamp';
  summary: string;
  category: string;
  // Freshness metadata, written by the server on every set_analysis entry.
  // Optional because the parser doesn't see them — they're stamped server-side.
  analyzedAtBaseBlob?: string;
  analyzedAtHeadBlob?: string;
}
```

The parser logic itself doesn't change — agents don't write these fields. The server is responsible for stamping them after parse.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/__tests__/parse-analysis.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/parse-analysis.ts server/__tests__/parse-analysis.test.ts
git commit -m "feat(parse-analysis): add optional freshness fields to FileAnalysis"
```

---

### Task 3: `freshness.ts` pure function

**Files:**
- Create: `server/freshness.ts`
- Test: `server/__tests__/freshness.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/freshness.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeFreshness } from '../freshness.js';
import type { FileAnalysis } from '../parse-analysis.js';
import type { RawDiffEntry } from '../git-ops.js';

const fa = (extra: Partial<FileAnalysis> = {}): FileAnalysis => ({
  priority: 'normal',
  phase: 'review',
  summary: '',
  category: '',
  analyzedAtBaseBlob: 'BASE',
  analyzedAtHeadBlob: 'HEAD',
  ...extra,
});

const rd = (oldBlob: string, newBlob: string, status = 'M'): RawDiffEntry => ({
  oldBlob, newBlob, status,
});

describe('computeFreshness', () => {
  it('marks files as fresh when both blobs match', () => {
    const result = computeFreshness({
      storedFiles: { 'a.ts': fa() },
      currentDiff: new Map([['a.ts', rd('BASE', 'HEAD')]]),
      synthesizedAtFileSet: ['a.ts'],
    });
    expect(result.staleFiles).toEqual([]);
    expect(result.missingFiles).toEqual([]);
    expect(result.removedFiles).toEqual([]);
    expect(result.staleSynthesis).toBe(false);
  });

  it('marks file as stale when newBlob differs', () => {
    const result = computeFreshness({
      storedFiles: { 'a.ts': fa() },
      currentDiff: new Map([['a.ts', rd('BASE', 'NEW_HEAD')]]),
      synthesizedAtFileSet: ['a.ts'],
    });
    expect(result.staleFiles).toEqual(['a.ts']);
    expect(result.staleSynthesis).toBe(true);
  });

  it('marks file as stale when oldBlob differs (base advanced)', () => {
    const result = computeFreshness({
      storedFiles: { 'a.ts': fa() },
      currentDiff: new Map([['a.ts', rd('NEW_BASE', 'HEAD')]]),
      synthesizedAtFileSet: ['a.ts'],
    });
    expect(result.staleFiles).toEqual(['a.ts']);
  });

  it('flags files in current diff but not in stored as missing', () => {
    const result = computeFreshness({
      storedFiles: {},
      currentDiff: new Map([['new.ts', rd('0', 'X', 'A')]]),
      synthesizedAtFileSet: [],
    });
    expect(result.missingFiles).toEqual(['new.ts']);
    expect(result.staleSynthesis).toBe(true);
  });

  it('flags files in stored but not in current diff as removed', () => {
    const result = computeFreshness({
      storedFiles: { 'gone.ts': fa() },
      currentDiff: new Map(),
      synthesizedAtFileSet: ['gone.ts'],
    });
    expect(result.removedFiles).toEqual(['gone.ts']);
    expect(result.staleSynthesis).toBe(true);
  });

  it('treats stored entries with absent blob fields as fully stale (legacy migration)', () => {
    const legacy: FileAnalysis = { priority: 'normal', phase: 'review', summary: '', category: '' };
    const result = computeFreshness({
      storedFiles: { 'a.ts': legacy },
      currentDiff: new Map([['a.ts', rd('BASE', 'HEAD')]]),
      synthesizedAtFileSet: ['a.ts'],
    });
    expect(result.staleFiles).toEqual(['a.ts']);
  });

  it('flags synthesis as stale when fileSet differs even if all files are fresh', () => {
    const result = computeFreshness({
      storedFiles: {
        'a.ts': fa(),
        'b.ts': fa({ analyzedAtBaseBlob: 'B2', analyzedAtHeadBlob: 'H2' }),
      },
      currentDiff: new Map([
        ['a.ts', rd('BASE', 'HEAD')],
        ['b.ts', rd('B2', 'H2')],
      ]),
      synthesizedAtFileSet: ['a.ts'], // b.ts not in synthesis fileSet
    });
    expect(result.staleFiles).toEqual([]);
    expect(result.staleSynthesis).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/__tests__/freshness.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `freshness.ts`**

Create `server/freshness.ts`:

```typescript
import type { FileAnalysis } from './parse-analysis.js';
import type { RawDiffEntry } from './git-ops.js';

export interface AnalysisFreshness {
  staleFiles: string[];
  missingFiles: string[];
  removedFiles: string[];
  staleSynthesis: boolean;
}

export interface ComputeFreshnessInput {
  storedFiles: Record<string, FileAnalysis>;
  currentDiff: Map<string, RawDiffEntry>;
  synthesizedAtFileSet: string[];
}

export function computeFreshness(input: ComputeFreshnessInput): AnalysisFreshness {
  const { storedFiles, currentDiff, synthesizedAtFileSet } = input;

  const staleFiles: string[] = [];
  const missingFiles: string[] = [];
  const removedFiles: string[] = [];

  // Files in stored: check stale or removed.
  for (const [path, entry] of Object.entries(storedFiles)) {
    const cur = currentDiff.get(path);
    if (!cur) {
      removedFiles.push(path);
      continue;
    }
    const storedBase = entry.analyzedAtBaseBlob ?? '';
    const storedHead = entry.analyzedAtHeadBlob ?? '';
    if (storedBase !== cur.oldBlob || storedHead !== cur.newBlob) {
      staleFiles.push(path);
    }
  }

  // Files in current diff but not in stored: missing.
  for (const path of currentDiff.keys()) {
    if (!(path in storedFiles)) {
      missingFiles.push(path);
    }
  }

  // Synthesis is stale if any file is stale/missing/removed OR fileSet differs.
  const currentFileSet = new Set(Object.keys(storedFiles).filter(p => !removedFiles.includes(p)));
  for (const p of missingFiles) currentFileSet.add(p);
  const synthesizedSet = new Set(synthesizedAtFileSet);
  const fileSetDiffers =
    currentFileSet.size !== synthesizedSet.size ||
    [...currentFileSet].some(p => !synthesizedSet.has(p));

  const staleSynthesis =
    staleFiles.length > 0 ||
    missingFiles.length > 0 ||
    removedFiles.length > 0 ||
    fileSetDiffers;

  staleFiles.sort();
  missingFiles.sort();
  removedFiles.sort();

  return { staleFiles, missingFiles, removedFiles, staleSynthesis };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/__tests__/freshness.test.ts
```

Expected: PASS — all seven cases.

- [ ] **Step 5: Commit**

```bash
git add server/freshness.ts server/__tests__/freshness.test.ts
git commit -m "feat(freshness): pure freshness compute over stored analysis + raw diff"
```

---

### Task 4: Session augmentation — store `synthesizedAtFileSet`, expose freshness

**Files:**
- Modify: `server/session.ts`
- Test: `server/__tests__/session.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/session.test.ts` (adjust import paths to match existing test conventions):

```typescript
it('stores synthesizedAtFileSet on setAnalysis', () => {
  const session = makeTestSession();
  session.setAnalysis({
    overview: 'o',
    reviewStrategy: 's',
    files: { 'a.ts': { priority: 'normal', phase: 'review', summary: '', category: '' } },
    groups: [],
    synthesizedAtFileSet: ['a.ts'],
  });
  const a = session.analysis as Record<string, unknown>;
  expect(a.synthesizedAtFileSet).toEqual(['a.ts']);
});

it('stamps blob SHAs on file entries when stamping is provided', () => {
  const session = makeTestSession();
  session.setAnalysis({
    overview: 'o', reviewStrategy: 's', files: {}, groups: [], synthesizedAtFileSet: [],
  });
  // Direct access to mergeAnalysis since setAnalysis doesn't take blob input.
  session.mergeAnalysis({
    files: { 'a.ts': { priority: 'normal', phase: 'review', summary: '', category: '' } },
    synthesisIfProvided: null,
    blobsByPath: { 'a.ts': { oldBlob: 'B', newBlob: 'H' } },
    removedFiles: [],
  });
  const a = session.analysis as { files: Record<string, { analyzedAtBaseBlob?: string; analyzedAtHeadBlob?: string }> };
  expect(a.files['a.ts'].analyzedAtBaseBlob).toBe('B');
  expect(a.files['a.ts'].analyzedAtHeadBlob).toBe('H');
});
```

`makeTestSession()` should construct a Session pointing at a temp repo. Pattern this on existing helpers in the file.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/__tests__/session.test.ts
```

Expected: FAIL — `mergeAnalysis` does not exist on Session.

- [ ] **Step 3: Implement session augmentation**

In `server/session.ts`, replace `setAnalysis` and add `mergeAnalysis`:

```typescript
import type { FileAnalysis } from './parse-analysis.js';

setAnalysis(analysis: Record<string, unknown>): void {
  this._analysis = analysis;
  this.persist();
}

/**
 * Merge new file entries into the existing analysis, drop entries listed in
 * removedFiles, and (if synthesisIfProvided is non-null) replace the synthesis.
 * Stamps blob SHAs on every entry written.
 */
mergeAnalysis(input: {
  files: Record<string, FileAnalysis>;
  synthesisIfProvided: { overview: string; reviewStrategy: string; opinion?: string; groups: import('./parse-analysis.js').AnalysisGroup[]; synthesizedAtFileSet: string[] } | null;
  blobsByPath: Record<string, { oldBlob: string; newBlob: string }>;
  removedFiles: string[];
}): void {
  const prev = (this._analysis ?? {}) as {
    overview?: string;
    reviewStrategy?: string;
    files?: Record<string, FileAnalysis>;
    groups?: import('./parse-analysis.js').AnalysisGroup[];
    synthesizedAtFileSet?: string[];
  };
  const mergedFiles: Record<string, FileAnalysis> = { ...(prev.files ?? {}) };
  for (const path of input.removedFiles) delete mergedFiles[path];
  for (const [path, entry] of Object.entries(input.files)) {
    const blobs = input.blobsByPath[path];
    mergedFiles[path] = {
      ...entry,
      analyzedAtBaseBlob: blobs?.oldBlob ?? entry.analyzedAtBaseBlob ?? '',
      analyzedAtHeadBlob: blobs?.newBlob ?? entry.analyzedAtHeadBlob ?? '',
    };
  }
  const synthesis = input.synthesisIfProvided;
  this._analysis = {
    overview: synthesis?.overview ?? prev.overview ?? '',
    reviewStrategy: synthesis?.reviewStrategy ?? prev.reviewStrategy ?? '',
    files: mergedFiles,
    groups: synthesis?.groups ?? prev.groups ?? [],
    synthesizedAtFileSet: synthesis?.synthesizedAtFileSet ?? prev.synthesizedAtFileSet ?? [],
  };
  this.persist();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/__tests__/session.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/session.ts server/__tests__/session.test.ts
git commit -m "feat(session): add mergeAnalysis with blob-SHA stamping"
```

---

### Task 5: Session — `getAnalysisWithFreshness()` + freshness cache

**Files:**
- Modify: `server/session.ts`
- Test: `server/__tests__/session.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/session.test.ts`:

```typescript
it('getAnalysisWithFreshness returns null when no analysis is set', () => {
  const session = makeTestSession();
  expect(session.getAnalysisWithFreshness()).toBeNull();
});

it('getAnalysisWithFreshness reports staleFiles for unstamped legacy entries', () => {
  const session = makeTestSession(); // session backed by a temp repo with one tracked diff
  // Seed a legacy-shape analysis (no blob fields).
  session.setAnalysis({
    overview: 'o', reviewStrategy: 's',
    files: { 'a.ts': { priority: 'normal', phase: 'review', summary: '', category: '' } },
    groups: [], synthesizedAtFileSet: ['a.ts'],
  });
  // The temp repo's branch contains a.ts as a diff.
  const result = session.getAnalysisWithFreshness();
  expect(result).not.toBeNull();
  expect(result!.freshness.staleFiles).toContain('a.ts');
});
```

The repo helper for `makeTestSession` should already exist in test setup; if not, build a fixture branch with `a.ts` modified.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/__tests__/session.test.ts
```

Expected: FAIL — `getAnalysisWithFreshness` not defined.

- [ ] **Step 3: Implement**

In `server/session.ts`:

```typescript
import { getBranchDiffRaw } from './git-ops.js';
import { computeFreshness, type AnalysisFreshness } from './freshness.js';

// Field on the Session class:
private _freshnessCache: { headSha: string; baseSha: string; freshness: AnalysisFreshness; computedAt: number } | null = null;

getAnalysisWithFreshness(): { analysis: Record<string, unknown>; freshness: AnalysisFreshness; computedAtHead: string; computedAtBase: string } | null {
  if (!this._analysis) return null;

  const headSha = gitRun(this.repoPath, 'rev-parse', 'HEAD');
  let baseSha: string;
  try {
    baseSha = gitRun(this.repoPath, 'rev-parse', this.baseBranch);
  } catch {
    baseSha = '';
  }

  const now = Date.now();
  const cached = this._freshnessCache;
  if (cached && cached.headSha === headSha && cached.baseSha === baseSha && now - cached.computedAt < 5000) {
    return { analysis: this._analysis, freshness: cached.freshness, computedAtHead: headSha, computedAtBase: baseSha };
  }

  const stored = (this._analysis as { files?: Record<string, FileAnalysis>; synthesizedAtFileSet?: string[] });
  const currentDiff = getBranchDiffRaw(this.repoPath, this.baseBranch);
  const freshness = computeFreshness({
    storedFiles: stored.files ?? {},
    currentDiff,
    synthesizedAtFileSet: stored.synthesizedAtFileSet ?? [],
  });

  this._freshnessCache = { headSha, baseSha, freshness, computedAt: now };
  return { analysis: this._analysis, freshness, computedAtHead: headSha, computedAtBase: baseSha };
}

/** Returns the raw diff blob map alongside HEAD/base SHAs. Used by mergeAnalysis call sites. */
getCurrentBlobMap(): { blobsByPath: Record<string, { oldBlob: string; newBlob: string }>; headSha: string; baseSha: string } {
  const headSha = gitRun(this.repoPath, 'rev-parse', 'HEAD');
  let baseSha = '';
  try { baseSha = gitRun(this.repoPath, 'rev-parse', this.baseBranch); } catch { /* ignore */ }
  const map = getBranchDiffRaw(this.repoPath, this.baseBranch);
  const blobsByPath: Record<string, { oldBlob: string; newBlob: string }> = {};
  for (const [path, entry] of map) blobsByPath[path] = { oldBlob: entry.oldBlob, newBlob: entry.newBlob };
  return { blobsByPath, headSha, baseSha };
}
```

Add an explicit `gitRun` import at the top of `session.ts` if not already present.

Add cache invalidation to `setAnalysis` and `mergeAnalysis`:

```typescript
setAnalysis(analysis: Record<string, unknown>): void {
  this._analysis = analysis;
  this._freshnessCache = null;
  this.persist();
}

// At the end of mergeAnalysis, before this.persist():
this._freshnessCache = null;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/__tests__/session.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/session.ts server/__tests__/session.test.ts
git commit -m "feat(session): freshness query with HEAD+base SHA cache"
```

---

## Phase 3 — REST + MCP read API

### Task 6: `GET /project/:slug/analysis/freshness` route

**Files:**
- Modify: `server/app.ts`
- Test: `server/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/routes.test.ts`:

```typescript
it('GET /analysis/freshness returns the freshness shape', async () => {
  const slug = await registerAndSeedAnalysis(); // helper that sets a stale-on-purpose analysis
  const res = await request(app).get(`/project/${slug}/analysis/freshness`);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.staleFiles)).toBe(true);
  expect(typeof res.body.staleSynthesis).toBe('boolean');
  expect(typeof res.body.computedAtHead).toBe('string');
  expect(typeof res.body.computedAtBase).toBe('string');
});

it('GET /analysis/freshness returns 404 when analysis is unset', async () => {
  const slug = await registerEmpty();
  const res = await request(app).get(`/project/${slug}/analysis/freshness`);
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/__tests__/routes.test.ts
```

Expected: FAIL — 404 for both cases (route not defined).

- [ ] **Step 3: Implement the route**

In `server/app.ts`, near other `projectRouter.get('/analysis...'` routes:

```typescript
projectRouter.get('/analysis/freshness', (_req, res) => {
  const session = res.locals.session;
  const result = session.getAnalysisWithFreshness();
  if (!result) {
    res.status(404).json({ error: 'No analysis set for this project' });
    return;
  }
  res.json({
    staleFiles: result.freshness.staleFiles,
    missingFiles: result.freshness.missingFiles,
    removedFiles: result.freshness.removedFiles,
    staleSynthesis: result.freshness.staleSynthesis,
    computedAtHead: result.computedAtHead,
    computedAtBase: result.computedAtBase,
  });
});
```

If `GET /analysis` already exists, augment it to include the freshness block in the same shape (top-level `freshness` field on the response). If it doesn't exist as a separate route, the frontend reads analysis through the session blob endpoint — find that and add the freshness field there too.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/__tests__/routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/__tests__/routes.test.ts
git commit -m "feat(api): GET /analysis/freshness"
```

---

### Task 7: `read_analysis` MCP tool

**Files:**
- Modify: `server/mcp.ts`
- Test: `server/__tests__/mcp.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/mcp.test.ts`:

```typescript
it('read_analysis returns json + markdown + freshness for a project with analysis', async () => {
  const { slug } = await registerProjectWithAnalysis();
  const result = await callMcpTool('read_analysis', { repoPath: pathFor(slug) });
  const payload = JSON.parse(result.content[0].text);
  expect(payload).toHaveProperty('json');
  expect(payload).toHaveProperty('markdown');
  expect(payload).toHaveProperty('freshness');
  expect(payload.markdown).toMatch(/^## /m);
});

it('read_analysis returns null json when no analysis is set', async () => {
  const { slug } = await registerEmptyProject();
  const result = await callMcpTool('read_analysis', { repoPath: pathFor(slug) });
  const payload = JSON.parse(result.content[0].text);
  expect(payload.json).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/__tests__/mcp.test.ts
```

Expected: FAIL — tool not registered.

- [ ] **Step 3: Implement `read_analysis` + a markdown renderer**

Add at the top of `server/mcp.ts`:

```typescript
import type { FileAnalysis } from './parse-analysis.js';

function renderFileAnalysisMarkdown(files: Record<string, FileAnalysis>): string {
  const paths = Object.keys(files).sort();
  return paths.map(path => {
    const f = files[path];
    return `## ${path}\n- priority: ${f.priority}\n- phase: ${f.phase}\n- category: ${f.category}\n\n${f.summary}\n`;
  }).join('\n');
}
```

Add the tool inside `createMcpServer`, near `set_analysis`:

```typescript
server.tool(
  'read_analysis',
  'Read the previous analysis for this project, including per-file freshness data. Returns JSON, the file analysis re-rendered as markdown (suitable for passing to file-classifier as prior context), and freshness metadata listing stale/missing/removed files. Used by the /lgtm refresh skill.',
  {
    repoPath: z.string().describe('Absolute path to the git repository'),
  },
  async ({ repoPath }) => {
    const { found } = resolveProject(manager, repoPath, server);
    const result = found.session.getAnalysisWithFreshness();
    if (!result) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ json: null, markdown: '', freshness: null }) }] };
    }
    const stored = result.analysis as { files?: Record<string, FileAnalysis> };
    const markdown = renderFileAnalysisMarkdown(stored.files ?? {});
    console.log(`MCP_READ_ANALYSIS slug=${found.slug} files=${Object.keys(stored.files ?? {}).length} stale=${result.freshness.staleFiles.length}`);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        json: result.analysis,
        markdown,
        freshness: {
          staleFiles: result.freshness.staleFiles,
          missingFiles: result.freshness.missingFiles,
          removedFiles: result.freshness.removedFiles,
          staleSynthesis: result.freshness.staleSynthesis,
          computedAtHead: result.computedAtHead,
          computedAtBase: result.computedAtBase,
        },
      }) }],
    };
  },
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/__tests__/mcp.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/mcp.ts server/__tests__/mcp.test.ts
git commit -m "feat(mcp): read_analysis tool returns json + markdown + freshness"
```

---

## Phase 4 — Mutation API + SSE

### Task 8: `set_analysis` `mode: "merge"` + `removedFiles` parameter

**Files:**
- Modify: `server/mcp.ts:164-212`
- Test: `server/__tests__/mcp.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/mcp.test.ts`:

```typescript
it('set_analysis mode=merge preserves entries not in the new payload', async () => {
  const { slug, fullAnalysisPath, partialPath, synthesisPath } = await setupMergeFixture();
  // First: full set with files a.ts and b.ts.
  await callMcpTool('set_analysis', {
    repoPath: pathFor(slug),
    fileAnalysisPath: fullAnalysisPath, // contains a.ts and b.ts
    synthesisPath,
  });
  // Second: merge with only a.ts.
  await callMcpTool('set_analysis', {
    repoPath: pathFor(slug),
    fileAnalysisPath: partialPath, // contains only a.ts
    synthesisPath,
    mode: 'merge',
  });
  const session = sessionFor(slug);
  const a = session.analysis as { files: Record<string, unknown> };
  expect(Object.keys(a.files).sort()).toEqual(['a.ts', 'b.ts']);
});

it('set_analysis mode=merge with removedFiles drops listed entries', async () => {
  const { slug, fullAnalysisPath, partialPath, synthesisPath } = await setupMergeFixture();
  await callMcpTool('set_analysis', { repoPath: pathFor(slug), fileAnalysisPath: fullAnalysisPath, synthesisPath });
  await callMcpTool('set_analysis', {
    repoPath: pathFor(slug),
    fileAnalysisPath: partialPath,
    synthesisPath,
    mode: 'merge',
    removedFiles: ['b.ts'],
  });
  const session = sessionFor(slug);
  const a = session.analysis as { files: Record<string, unknown> };
  expect(Object.keys(a.files)).toEqual(['a.ts']);
});

it('set_analysis broadcasts analysis_changed SSE event', async () => {
  const { slug } = await setupBasic();
  const events: string[] = [];
  const session = sessionFor(slug);
  // Patch broadcast to capture events.
  const orig = session.broadcast.bind(session);
  session.broadcast = (event: string, data: unknown) => { events.push(event); orig(event, data); };
  await callMcpTool('set_analysis', basicArgs(slug));
  expect(events).toContain('analysis_changed');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/__tests__/mcp.test.ts
```

Expected: FAIL — merge mode unsupported, no broadcast.

- [ ] **Step 3: Implement merge mode + broadcast**

Replace the `set_analysis` tool in `server/mcp.ts`:

```typescript
server.tool(
  'set_analysis',
  'Set file-level analysis data (priorities, summaries, groupings) from analyzer agent output files. mode="replace" (default) replaces the entire analysis; mode="merge" merges new file entries into the existing analysis, preserving entries not in the new payload (use `removedFiles` for explicit drops). Broadcasts analysis_changed on success.',
  {
    repoPath: z.string().describe('Absolute path to the git repository'),
    fileAnalysisPath: z.string().describe('Absolute path to the file-analyzer markdown output'),
    synthesisPath: z.string().describe('Absolute path to the synthesis agent markdown output'),
    reviewGuidePath: z.string().optional().describe('Absolute path to a markdown review guide (overview, strategy, opinion) to add as a reviewable document'),
    mode: z.enum(['replace', 'merge']).optional().describe('replace (default) or merge'),
    removedFiles: z.array(z.string()).optional().describe('When mode=merge, paths to drop from the merged result'),
  },
  async ({ repoPath, fileAnalysisPath, synthesisPath, reviewGuidePath, mode, removedFiles }) => {
    const { found } = resolveProject(manager, repoPath, server);
    try {
      const files = parseFileAnalysis(readFileSync(fileAnalysisPath, 'utf-8'));
      const synthesis = parseSynthesis(readFileSync(synthesisPath, 'utf-8'));
      const { blobsByPath } = found.session.getCurrentBlobMap();

      if (mode === 'merge') {
        const synthesizedAtFileSet = (() => {
          // Compute the post-merge file set: previous keys minus removedFiles, union new keys.
          const prev = (found.session.analysis as { files?: Record<string, FileAnalysis> })?.files ?? {};
          const next = new Set(Object.keys(prev));
          for (const r of removedFiles ?? []) next.delete(r);
          for (const k of Object.keys(files)) next.add(k);
          return [...next].sort();
        })();
        found.session.mergeAnalysis({
          files,
          synthesisIfProvided: { ...synthesis, synthesizedAtFileSet },
          blobsByPath,
          removedFiles: removedFiles ?? [],
        });
      } else {
        // Replace mode: stamp blobs, then set wholesale.
        const stampedFiles: Record<string, FileAnalysis> = {};
        for (const [path, entry] of Object.entries(files)) {
          const blobs = blobsByPath[path];
          stampedFiles[path] = {
            ...entry,
            analyzedAtBaseBlob: blobs?.oldBlob ?? '',
            analyzedAtHeadBlob: blobs?.newBlob ?? '',
          };
        }
        found.session.setAnalysis({
          overview: synthesis.overview,
          reviewStrategy: synthesis.reviewStrategy,
          files: stampedFiles,
          groups: synthesis.groups,
          synthesizedAtFileSet: Object.keys(stampedFiles).sort(),
        });
      }

      found.session.broadcast('analysis_changed', { mode: mode ?? 'replace' });

      if (reviewGuidePath) {
        found.session.addItem('review-guide', 'Review Guide', reviewGuidePath);
        found.session.broadcast('items_changed', { id: 'review-guide' });
      }

      console.log(`MCP_SET_ANALYSIS slug=${found.slug} mode=${mode ?? 'replace'} files=${Object.keys(files).length} removed=${(removedFiles ?? []).length} groups=${synthesis.groups.length}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          ok: true,
          fileCount: Object.keys(files).length,
          removedCount: (removedFiles ?? []).length,
          groupCount: synthesis.groups.length,
          reviewGuide: !!reviewGuidePath,
          mode: mode ?? 'replace',
        }) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`MCP_SET_ANALYSIS_FAIL slug=${found.slug} error=${msg}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }] };
    }
  },
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/__tests__/mcp.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/mcp.ts server/__tests__/mcp.test.ts
git commit -m "feat(mcp): set_analysis merge mode with blob stamping + analysis_changed event"
```

---

## Phase 5 — ProjectClaim + connection-state + refresh-analysis route

### Task 9: Per-project claim record + `getProjectClaim()`

**Files:**
- Modify: `server/mcp.ts`
- Test: `server/__tests__/mcp.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/mcp.test.ts`:

```typescript
it('getProjectClaim returns the latest claimer for a slug', async () => {
  const { slug } = await registerEmptyProject();
  // No claim yet.
  expect(getProjectClaim(slug)).toBeNull();
  // Calling claim_reviews assigns a claim.
  await callMcpTool('claim_reviews', { repoPath: pathFor(slug) });
  const claim = getProjectClaim(slug);
  expect(claim).not.toBeNull();
  expect(claim!.slug).toBe(slug);
  expect(typeof claim!.sessionId).toBe('string');
});
```

Import `getProjectClaim` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/__tests__/mcp.test.ts
```

Expected: FAIL — `getProjectClaim` not exported.

- [ ] **Step 3: Implement `ProjectClaim` map**

Add to `server/mcp.ts`:

```typescript
export interface ProjectClaim {
  slug: string;
  sessionId: string;
  claimedAt: string;
}

const projectClaims = new Map<string, ProjectClaim>(); // keyed by slug

function setProjectClaim(slug: string, sessionId: string): void {
  projectClaims.set(slug, { slug, sessionId, claimedAt: new Date().toISOString() });
}

function clearProjectClaimsForSession(sessionId: string): void {
  for (const [slug, claim] of projectClaims) {
    if (claim.sessionId === sessionId) projectClaims.delete(slug);
  }
}

export function getProjectClaim(slug: string): ProjectClaim | null {
  return projectClaims.get(slug) ?? null;
}

export function isClaimAlive(slug: string): boolean {
  const claim = projectClaims.get(slug);
  if (!claim) return false;
  return activeMcpSessions.has(claim.sessionId);
}
```

Wire into `claimDiffReviews` so the per-project claim is set whenever an MCP session claims:

```typescript
function claimDiffReviews(server: McpServer, slug: string): void {
  for (const entry of activeMcpSessions.values()) {
    if (entry.projectSlug === slug) entry.claimedDiff = false;
  }
  for (const [sid, entry] of activeMcpSessions) {
    if (entry.server === server) {
      entry.claimedDiff = true;
      setProjectClaim(slug, sid);
      return;
    }
  }
}
```

Same for `autoClaimDiffReviewsIfUnheld`:

```typescript
function autoClaimDiffReviewsIfUnheld(server: McpServer, slug: string): void {
  for (const entry of activeMcpSessions.values()) {
    if (entry.projectSlug === slug && entry.claimedDiff) return;
  }
  for (const [sid, entry] of activeMcpSessions) {
    if (entry.server === server) {
      entry.claimedDiff = true;
      setProjectClaim(slug, sid);
      return;
    }
  }
}
```

Hook cleanup into `transport.onclose`:

```typescript
transport.onclose = () => {
  const sid = transport.sessionId;
  if (sid) {
    clearProjectClaimsForSession(sid);
    activeMcpSessions.delete(sid);
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/__tests__/mcp.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/mcp.ts server/__tests__/mcp.test.ts
git commit -m "feat(mcp): per-project claim record with cleanup on transport close"
```

---

### Task 10: `GET /project/:slug/connection-state`

**Files:**
- Modify: `server/app.ts`
- Test: `server/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/routes.test.ts`:

```typescript
it('GET /connection-state reports claimed=false when nothing has called claim_reviews', async () => {
  const slug = await registerEmpty();
  const res = await request(app).get(`/project/${slug}/connection-state`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ claimed: false, alive: false, claimedAt: null });
});

it('GET /connection-state reports claimed+alive after claim_reviews', async () => {
  const { slug } = await claimViaMcp(); // helper: opens MCP transport + calls claim_reviews
  const res = await request(app).get(`/project/${slug}/connection-state`);
  expect(res.body.claimed).toBe(true);
  expect(res.body.alive).toBe(true);
  expect(typeof res.body.claimedAt).toBe('string');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/__tests__/routes.test.ts
```

Expected: FAIL — route returns 404.

- [ ] **Step 3: Implement route**

In `server/app.ts`, near other `projectRouter.get(...)` routes (the existing pattern reads `slug` from URL params via `(req.params as Record<string, string>).slug`):

```typescript
import { getProjectClaim, isClaimAlive } from './mcp.js';

projectRouter.get('/connection-state', (req, res) => {
  const slug = (req.params as Record<string, string>).slug;
  const claim = getProjectClaim(slug);
  res.json({
    claimed: !!claim,
    alive: claim ? isClaimAlive(slug) : false,
    claimedAt: claim?.claimedAt ?? null,
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/__tests__/routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/__tests__/routes.test.ts
git commit -m "feat(api): GET /connection-state reports claim + transport liveness"
```

---

### Task 11: `POST /project/:slug/refresh-analysis` route

**Files:**
- Modify: `server/app.ts`
- Test: `server/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/routes.test.ts`:

```typescript
it('POST /refresh-analysis returns delivered=false when no claim exists', async () => {
  const slug = await registerAndSeedAnalysis();
  const res = await request(app).post(`/project/${slug}/refresh-analysis`);
  expect(res.status).toBe(200);
  expect(res.body.delivered).toBe(false);
  expect(typeof res.body.reason).toBe('string');
});

it('POST /refresh-analysis sends a channel notification with the right meta when a claim is alive', async () => {
  const { slug, captured } = await claimViaMcpAndCaptureNotifications();
  await registerAnalysisFor(slug);
  const res = await request(app).post(`/project/${slug}/refresh-analysis`);
  expect(res.body.delivered).toBe(true);
  // captured: array of { content, meta } from notifyChannel
  const last = captured[captured.length - 1];
  expect(last.meta.event).toBe('refresh_analysis_requested');
  expect(last.meta.project).toBe(slug);
  // content is JSON-encoded freshness payload
  const payload = JSON.parse(last.content);
  expect(Array.isArray(payload.staleFiles)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/__tests__/routes.test.ts
```

Expected: FAIL — 404.

- [ ] **Step 3: Implement route**

In `server/app.ts`:

```typescript
import { notifyChannel } from './mcp.js';

projectRouter.post('/refresh-analysis', (req, res) => {
  const session = res.locals.session;
  const slug = (req.params as Record<string, string>).slug;
  const result = session.getAnalysisWithFreshness();
  if (!result) {
    res.status(404).json({ delivered: false, reason: 'No analysis set' });
    return;
  }
  const claim = getProjectClaim(slug);
  if (!claim || !isClaimAlive(slug)) {
    res.json({ delivered: false, reason: 'No live Claude claim' });
    return;
  }
  const content = JSON.stringify({
    staleFiles: result.freshness.staleFiles,
    missingFiles: result.freshness.missingFiles,
    removedFiles: result.freshness.removedFiles,
    staleSynthesis: result.freshness.staleSynthesis,
  });
  notifyChannel(content, { event: 'refresh_analysis_requested', project: slug });
  console.log(`REFRESH_ANALYSIS_REQUESTED slug=${slug} stale=${result.freshness.staleFiles.length}`);
  res.json({ delivered: true });
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/__tests__/routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/__tests__/routes.test.ts
git commit -m "feat(api): POST /refresh-analysis sends channel notification to claimed Claude"
```

---

## Phase 6 — Frontend wiring

> **UI tasks below skip unit tests** per project policy (verify in browser instead). Implement, then run the dev server and visually confirm.

### Task 12: Extend frontend `Analysis` type + add freshness/connection signals

**Files:**
- Modify: `frontend/src/state.ts`

- [ ] **Step 1: Extend the type and add signals**

In `frontend/src/state.ts`:

```typescript
interface FileAnalysis {
  priority: 'critical' | 'important' | 'normal' | 'low';
  phase: 'review' | 'skim' | 'rubber-stamp';
  summary: string;
  category: string;
  analyzedAtBaseBlob?: string;
  analyzedAtHeadBlob?: string;
}

export interface Analysis {
  overview: string;
  reviewStrategy: string;
  files: Record<string, FileAnalysis>;
  groups: AnalysisGroup[];
  synthesizedAtFileSet?: string[];
}

export interface AnalysisFreshness {
  staleFiles: string[];
  missingFiles: string[];
  removedFiles: string[];
  staleSynthesis: boolean;
  computedAtHead: string;
  computedAtBase: string;
}

export interface ConnectionState {
  claimed: boolean;
  alive: boolean;
  claimedAt: string | null;
}

export const [analysisFreshness, setAnalysisFreshness] = createSignal<AnalysisFreshness | null>(null);
export const [connectionState, setConnectionState] = createSignal<ConnectionState>({ claimed: false, alive: false, claimedAt: null });
```

- [ ] **Step 2: Verify TS compile**

```bash
npm run build:frontend
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/state.ts
git commit -m "feat(frontend): types + signals for freshness and connection state"
```

---

### Task 13: API client functions

**Files:**
- Create: `frontend/src/api/refresh.ts`

- [ ] **Step 1: Write the client module**

Create `frontend/src/api/refresh.ts`:

```typescript
import { apiUrl } from '../api'; // existing helper that prefixes /project/:slug
import type { AnalysisFreshness, ConnectionState } from '../state';

export async function fetchFreshness(): Promise<AnalysisFreshness | null> {
  const res = await fetch(apiUrl('/analysis/freshness'));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchFreshness: ${res.status}`);
  return res.json();
}

export async function fetchConnectionState(): Promise<ConnectionState> {
  const res = await fetch(apiUrl('/connection-state'));
  if (!res.ok) throw new Error(`fetchConnectionState: ${res.status}`);
  return res.json();
}

export async function postRefreshAnalysis(): Promise<{ delivered: boolean; reason?: string }> {
  const res = await fetch(apiUrl('/refresh-analysis'), { method: 'POST' });
  return res.json();
}
```

If `frontend/src/api.ts` exposes the URL helper under a different name, adapt the import.

- [ ] **Step 2: Verify TS compile**

```bash
npm run build:frontend
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/refresh.ts
git commit -m "feat(frontend): refresh API client (freshness, connection-state, post)"
```

---

### Task 14: SSE listener — `analysis_changed` and freshness refetch on `git_changed`

**Files:**
- Modify: `frontend/src/ProjectView.tsx:381-396`

- [ ] **Step 1: Add the listeners**

In `ProjectView.tsx`, the existing code already imports `fetchAnalysis` (line 52) and uses it via `setAnalysis(analysisData)` (lines 421-422). Add the new listener and helper near the existing `git_changed` listener (~line 396):

```typescript
import { fetchFreshness, fetchConnectionState } from './api/refresh';
import { setAnalysisFreshness, setConnectionState } from './state';

async function refetchFreshness() {
  try { setAnalysisFreshness(await fetchFreshness()); } catch { /* ignore */ }
}

async function refetchAnalysisAndFreshness() {
  const [a, f] = await Promise.all([fetchAnalysis().catch(() => null), fetchFreshness().catch(() => null)]);
  if (a) setAnalysis(a);
  setAnalysisFreshness(f);
}

es.addEventListener('analysis_changed', () => { void refetchAnalysisAndFreshness(); });
// Augment the existing git_changed handler — keep its current body and append:
es.addEventListener('git_changed', async () => {
  // ... existing body ...
  await refetchFreshness();
});
```

When extending the existing `git_changed` handler, preserve its current body; don't replace it.

Add an initial fetch on mount:

```typescript
onMount(async () => {
  // ... existing mount work ...
  setAnalysisFreshness(await fetchFreshness().catch(() => null));
  setConnectionState(await fetchConnectionState().catch(() => ({ claimed: false, alive: false, claimedAt: null })));
});
```

- [ ] **Step 2: Verify in browser**

Run dev server, open the project, set analysis (via `/lgtm analyze`), make a commit affecting one of the files, observe a `git_changed` SSE event, confirm freshness data updates without page reload (open DevTools → Network → EventSource).

```bash
npm run dev:all
```

Manual check: set `analysisFreshness()` to log on update; verify staleFiles populates after a commit.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/ProjectView.tsx
git commit -m "feat(frontend): SSE listener refetches freshness on analysis_changed/git_changed"
```

---

### Task 15: Per-file staleness badge in sidebar

**Files:**
- Modify: `frontend/src/sidebar/FileList.tsx` (or whatever the file row component is)
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Render the badge**

In the file row component, import and consume the freshness signal:

```typescript
import { analysisFreshness } from '../state';

// Inside the row JSX, after the priority chip:
<Show when={analysisFreshness()?.staleFiles.includes(file.path)}>
  <span class="stale-badge" title="Diff has changed since last analysis">●</span>
</Show>
```

In `style.css`:

```css
.stale-badge {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warning, #f0a020);
  margin-left: 4px;
  vertical-align: middle;
}
```

- [ ] **Step 2: Verify in browser**

Run `npm run dev:all`. Make sure files reported as stale (you can mock by editing a freshly-analyzed file and committing) show the badge.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/sidebar/FileList.tsx frontend/src/style.css
git commit -m "feat(sidebar): per-file staleness badge from freshness signal"
```

---

### Task 16: Connection indicator + refresh button in header

**Files:**
- Create: `frontend/src/header/ConnectionIndicator.tsx`
- Create: `frontend/src/header/RefreshButton.tsx`
- Modify: the existing header component (find via `frontend/src/header/`)
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Implement components**

Create `frontend/src/header/ConnectionIndicator.tsx`:

```typescript
import { connectionState } from '../state';

export function ConnectionIndicator() {
  return (
    <span
      class={`conn-dot ${connectionState().alive ? 'alive' : 'down'}`}
      title={connectionState().alive ? 'Claude session connected' : 'No Claude session connected'}
    />
  );
}
```

Create `frontend/src/header/RefreshButton.tsx`:

```typescript
import { Show, createMemo } from 'solid-js';
import { connectionState, analysisFreshness } from '../state';
import { postRefreshAnalysis } from '../api/refresh';

export function RefreshButton(props: { slug: string }) {
  const stale = createMemo(() => {
    const f = analysisFreshness();
    if (!f) return 0;
    return f.staleFiles.length + f.missingFiles.length + f.removedFiles.length;
  });
  const enabled = createMemo(() => connectionState().alive && stale() > 0);

  async function onClick() {
    if (enabled()) {
      const res = await postRefreshAnalysis();
      if (!res.delivered) copyFallbackPrompt(props.slug);
    } else {
      copyFallbackPrompt(props.slug);
    }
  }

  function copyFallbackPrompt(slug: string) {
    const text = `Run \`/lgtm refresh\` for project \`${slug}\``;
    navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <Show when={analysisFreshness()}>
      <button
        class="refresh-button"
        disabled={!enabled() && stale() === 0}
        onClick={onClick}
        title={enabled() ? 'Send refresh request to Claude' : (stale() === 0 ? 'Analysis is fresh' : 'No live Claude session — click to copy prompt')}
      >
        Refresh ({stale()} stale)
      </button>
    </Show>
  );
}
```

Wire both into the existing header layout (find by searching for the existing "Run analysis" affordance — `grep -rn "Run analysis\|analyze" frontend/src/header`).

In `style.css`:

```css
.conn-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}
.conn-dot.alive { background: var(--success, #4caf50); }
.conn-dot.down { background: var(--muted, #888); }

.refresh-button { /* match existing button styles */ }
.refresh-button:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 2: Verify in browser**

Run dev server. With Claude session running and connected via channels, confirm dot is green and refresh button enabled. Disconnect Claude (close the terminal), confirm dot turns muted.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/header/ConnectionIndicator.tsx frontend/src/header/RefreshButton.tsx frontend/src/header/* frontend/src/style.css
git commit -m "feat(header): connection indicator + refresh-analysis button"
```

---

### Task 17: Stale-count chip in analysis tab header

**Files:**
- Modify: the analysis sidebar/tab component (find via `grep -rn "overview\|reviewStrategy\|Review Strategy" frontend/src`)
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Add the chip**

Where the analysis overview/strategy is rendered, add:

```typescript
import { analysisFreshness } from '../state';

<Show when={analysisFreshness() && (analysisFreshness()!.staleFiles.length + analysisFreshness()!.missingFiles.length + analysisFreshness()!.removedFiles.length) > 0}>
  <span class="stale-chip">
    {analysisFreshness()!.staleFiles.length + analysisFreshness()!.missingFiles.length + analysisFreshness()!.removedFiles.length} stale
  </span>
</Show>
```

In `style.css`:

```css
.stale-chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--warning-bg, rgba(240, 160, 32, 0.15));
  color: var(--warning, #f0a020);
  font-size: 11px;
  margin-left: 8px;
}
```

- [ ] **Step 2: Verify in browser**

- [ ] **Step 3: Commit**

```bash
git add frontend/src/ frontend/src/style.css
git commit -m "feat(analysis): stale count chip in analysis header"
```

---

## Phase 7 — Skill + agent updates

### Task 18: Update `file-classifier` agent for delta mode

**Files:**
- Modify: `agents/file-classifier/AGENT.md`

- [ ] **Step 1: Add a Delta-mode section**

Append to `agents/file-classifier/AGENT.md` (after the existing instructions, before the output format examples):

```markdown
## Delta mode

Your task prompt may include:
- A path to the **previous analysis markdown** (file-classifier output from the last run).
- A list of **files to (re-)classify**.

When given these:

1. Read the previous analysis to inform your terminology and category choices — strive for consistency with prior classifications of related files (don't churn the category for `auth-middleware.ts` from "core logic" to "auth middleware" if the previous run called it "core logic" and nothing about it changed).
2. Classify **only the listed files** using the diff-reading rules above.
3. Output **only entries for the listed files** in the standard markdown format. Do NOT copy unchanged entries from the previous analysis into your output — the server merges them in. Including them in your output would still work, but it wastes tokens and risks paraphrasing summaries you weren't asked to change.
4. Removed files (paths in the previous analysis but no longer in the diff) are handled by the calling skill via a separate `removedFiles` argument to `set_analysis`. You don't need to mention them in your output.

When the previous analysis path is absent (full run), behave as documented above — classify every file in the diff.
```

- [ ] **Step 2: Verify in lints (if any)**

```bash
npm run lint || true
```

(The agent file is markdown; lint may not cover it. Skip if not applicable.)

- [ ] **Step 3: Commit**

```bash
git add agents/file-classifier/AGENT.md
git commit -m "docs(agent): file-classifier delta-mode prompt section"
```

---

### Task 19: New `/lgtm refresh` skill

**Files:**
- Create: `skills/refresh/SKILL.md`

- [ ] **Step 1: Author the skill**

Create `skills/refresh/SKILL.md`:

```markdown
---
name: refresh
description: >
  Refresh an existing LGTM analysis incrementally — re-classify only files whose
  diff has changed since the last analysis. Use after making commits on a long-
  lived branch when you want to keep the analysis layer fresh without redoing
  the full classification pass. Falls back to a full /lgtm analyze run if no
  prior analysis exists.
allowed-tools: "mcp__lgtm__read_analysis,mcp__plugin_lgtm_lgtm__read_analysis,mcp__lgtm__set_analysis,mcp__plugin_lgtm_lgtm__set_analysis,Agent,Bash(git:*),Read,Write"
---

# Refresh Skill

Incremental update of an existing analysis. The server already persists prior
state; this skill computes the delta, re-classifies only stale files, and
re-synthesizes.

## Pipeline

### Step 1: Read prior analysis

Call `read_analysis` with the repo path. The response contains:

- `json` — the full prior analysis (or `null` if none).
- `markdown` — file-classifier-format rendering of the prior file analysis.
- `freshness` — `{staleFiles, missingFiles, removedFiles, staleSynthesis, computedAtHead, computedAtBase}`.

If `json` is null, call the `analyze` skill instead — there's nothing to refresh.

If `freshness.staleFiles`, `missingFiles`, and `removedFiles` are all empty, report
"analysis is fresh, nothing to do" and exit.

### Step 2: Write prior markdown to scratch

Write the `markdown` field from `read_analysis` to
`/tmp/lgtm-analysis-files-prev.md`.

### Step 3: Spawn file-classifier in delta mode

Spawn the `file-classifier` agent. The prompt:

```
Refresh analysis for the repository at <REPO_PATH>.
The base branch is <BASE_BRANCH>.

Previous analysis (for category/style continuity):
/tmp/lgtm-analysis-files-prev.md

Re-classify ONLY these files (diffs have changed since last analysis):
- <each path from staleFiles ∪ missingFiles, one per line>

Use git commands to read each file's diff. Output ONLY the entries for these
files to /tmp/lgtm-analysis-files.md. Do NOT copy unchanged entries from the
previous analysis — the server merges them in.
```

### Step 4: Compose merged file analysis

Locally compose the merged file analysis (previous entries minus
`removedFiles`, overlaid with the new entries the agent just wrote) and save to
`/tmp/lgtm-analysis-files-merged.md`. This is the input to synthesizer.

A simple recipe: parse `/tmp/lgtm-analysis-files-prev.md`, drop `## <path>`
blocks for any path in `removedFiles ∪ staleFiles ∪ missingFiles`, then
concatenate with `/tmp/lgtm-analysis-files.md`.

### Step 5: Spawn synthesizer

Same as in `/lgtm analyze` — read merged file analysis, write synthesis +
review-guide markdown files. Re-uses the existing synthesizer agent unchanged.

### Step 6: Submit

Call `set_analysis` with:

- `repoPath`: the repo path
- `fileAnalysisPath`: `/tmp/lgtm-analysis-files.md` (the agent's delta-only output)
- `synthesisPath`: `/tmp/lgtm-analysis-synthesis.md`
- `reviewGuidePath`: `/tmp/lgtm-analysis-review-guide.md`
- `mode`: `"merge"`
- `removedFiles`: `freshness.removedFiles`

The server merges, stamps blob SHAs, and broadcasts `analysis_changed`.

## Reporting

Tell the user:
- N files re-classified
- M files dropped (removedFiles)
- Total file count after merge
- Synthesis re-run

If the tool returns an error, read the relevant markdown file to diagnose, fix
the agent's output, and retry.
```

- [ ] **Step 2: Verify the skill loads**

In a fresh Claude Code session, ask "what does the /lgtm refresh skill do?" and confirm the description appears.

- [ ] **Step 3: Commit**

```bash
git add skills/refresh/SKILL.md
git commit -m "feat(skill): /lgtm refresh — incremental analysis update"
```

---

### Task 20: Modify `/lgtm analyze` to delegate to refresh when prior exists

**Files:**
- Modify: `skills/analyze/SKILL.md`

- [ ] **Step 1: Add the delegation logic**

Add a new Step 0 at the top of the Pipeline section:

```markdown
### Step 0: Check for prior analysis

Call `read_analysis` with the repo path.

- If `json` is null: proceed with the full pipeline below.
- If `json` is non-null and `freshness` reports any of `staleFiles`,
  `missingFiles`, or `removedFiles` non-empty: invoke the `/lgtm refresh` skill
  instead. Do not run the full pipeline.
- If `json` is non-null and freshness is all-empty: report "analysis is fresh"
  and exit.

The full pipeline below runs only when `read_analysis` returns null `json`.
```

- [ ] **Step 2: Verify**

Manually test with a repo that has prior analysis: `/lgtm analyze` should delegate to refresh and produce the same result as `/lgtm refresh` directly.

- [ ] **Step 3: Commit**

```bash
git add skills/analyze/SKILL.md
git commit -m "feat(skill): /lgtm analyze delegates to refresh when prior analysis exists"
```

---

### Task 21: End-to-end integration test

**Files:**
- Create: `server/__tests__/refresh-flow.test.ts`

- [ ] **Step 1: Write the integration test**

Create `server/__tests__/refresh-flow.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Use the test helpers + supertest pattern from existing routes.test.ts
// Adapt setupRepo / registerProject helpers as needed.

describe('end-to-end refresh flow', () => {
  it('preserves untouched file entries after a partial refresh', async () => {
    // 1. Set up a temp repo with two files: a.ts and b.ts on a feature branch.
    // 2. Run set_analysis (replace) with both files classified.
    // 3. Make a commit modifying ONLY a.ts.
    // 4. Call read_analysis: freshness.staleFiles should be ['a.ts'].
    // 5. Call set_analysis with mode='merge' and a fileAnalysisPath containing only a.ts (different summary).
    // 6. Read analysis again: a.ts has the new summary; b.ts entry is unchanged from step 2.
  });

  it('drops entries listed in removedFiles after merge', async () => {
    // Similar but: delete b.ts from the working tree, commit, then call set_analysis(mode='merge', removedFiles=['b.ts']).
    // Result: only a.ts in analysis.files.
  });
});
```

Implement using the existing test helpers in `server/__tests__/helpers/`. Don't introduce a new fixture system — reuse what's there.

- [ ] **Step 2: Run the test**

```bash
npx vitest run server/__tests__/refresh-flow.test.ts
```

Expected: PASS for both cases.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/refresh-flow.test.ts
git commit -m "test(refresh): end-to-end flow preserves and drops correctly"
```

---

### Task 22: Manual smoke test + final commit

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass. If any pre-existing tests broke (likely from the analysis-shape touch points in Task 5/8), fix them before continuing.

- [ ] **Step 2: Manual smoke test**

```bash
npm run build
npm run dev:all
```

Manual checks:
1. Start a Claude session with channels: `claude --dangerously-load-development-channels plugin:lgtm@tomplex-lgtm`
2. In Claude: `/lgtm analyze` → confirm analysis appears in browser, header shows green dot
3. Edit a file in the diff, commit it
4. In browser: confirm staleness badge appears on that file, stale chip shows in analysis header
5. Click "Refresh" — confirm Claude receives the channel notification and runs `/lgtm refresh`
6. Confirm only the changed file was re-classified (Claude should report this in its skill output)
7. Confirm analysis_changed SSE event fires (DevTools → Network → EventSource → `analysis_changed`)
8. Disconnect Claude — confirm dot turns muted and refresh button shows fallback behavior (clicks copy prompt)

- [ ] **Step 3: Final commit (if rebuild needed)**

```bash
npm run build:frontend
git add frontend/dist
git commit -m "build: rebuild frontend dist with iterative analysis features"
```

---

## Spec coverage check

| Spec section | Task(s) |
|---|---|
| Freshness primitive (`git diff --raw`) | Task 1 |
| Data model — FileAnalysis fields | Task 2 |
| Data model — `synthesizedAtFileSet`, top-level `freshness` | Task 4, Task 5 |
| `getAnalysisWithFreshness` + cache keyed by HEAD/base | Task 5 |
| `GET /analysis/freshness` | Task 6 |
| `read_analysis` MCP tool | Task 7 |
| `set_analysis` `mode: "merge"` + `removedFiles` | Task 8 |
| `analysis_changed` SSE event | Task 8 |
| `ProjectClaim` record + cleanup | Task 9 |
| `GET /connection-state` | Task 10 |
| `POST /refresh-analysis` | Task 11 |
| Frontend types + signals | Task 12 |
| Frontend API client | Task 13 |
| Frontend SSE listener (`analysis_changed`, freshness on `git_changed`) | Task 14 |
| Per-file staleness badge | Task 15 |
| Refresh button + connection indicator | Task 16 |
| Stale count chip | Task 17 |
| `file-classifier` delta-mode prompt | Task 18 |
| `/lgtm refresh` skill | Task 19 |
| `/lgtm analyze` delegation | Task 20 |
| End-to-end integration test | Task 21 |
| Manual smoke test | Task 22 |
| Migration story (legacy blobs) | Covered by Task 3 (legacy detection) + Task 5 (treats absent fields as stale) |
| Liveness limitations doc | Captured in spec; no implementation task — no heartbeat in scope |
| Out-of-scope (heartbeat, managed Claude, walkthrough refresh, per-component synth updates) | None — explicitly future work |
