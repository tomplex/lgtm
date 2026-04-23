# Walkthrough Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship walkthrough mode — a Claude-authored narrative tour of the substantive logical changes in a branch, presented as an ordered sequence of focused stops with shared comments and review state with the diff view.

**Architecture:** A new `Walkthrough` artifact (summary + ordered `Stop`s, each referencing file + line-range artifacts) persisted on `Session` alongside `analysis`. A new MCP tool `set_walkthrough` accepts a markdown payload authored by a new `walkthrough-author` agent, parsed on the server. A new HTTP endpoint returns the walkthrough with a `stale` flag computed by comparing stored `diffHash` against the current diff's sha256. The frontend adds a `walkthroughMode` signal, a new `WalkthroughView` component tree, keyboard shortcuts (`W` enter, `d` exit, `↵`/`⇧↵` next/prev, `g<N>` jump), and stop-coverage badges on sidebar file rows. Comments live on the existing comment store — the walkthrough view reuses existing comment components. Two new skills (`/lgtm walkthrough`, `/lgtm prepare`) orchestrate.

**Tech Stack:** SolidJS + Vite (frontend), Express + better-sqlite3 + `@modelcontextprotocol/sdk` (server), TypeScript, vitest, supertest. See `CLAUDE.md` for build/test commands.

---

## Spec reference

- `docs/superpowers/specs/2026-04-23-walkthrough-mode-design.md`
- Existing analysis layer (pattern to mirror): `server/mcp.ts:153-200` (set_analysis tool), `server/parse-analysis.ts`, `server/session.ts:196-199` (setAnalysis), `skills/analyze/SKILL.md`.
- Existing keyboard hook: `frontend/src/hooks/useKeyboardShortcuts.ts`.
- Existing state module: `frontend/src/state.ts`.

---

## File structure

### New server files

- `server/walkthrough-types.ts` — `Stop`, `StopArtifact`, `HunkRef`, `Walkthrough` interfaces.
- `server/diff-hash.ts` — `sha256Hex(input: string): string` helper for staleness detection.
- `server/parse-walkthrough.ts` — markdown → `Walkthrough` parser (mirrors `parse-analysis.ts`).
- `server/__tests__/parse-walkthrough.test.ts`.
- `server/__tests__/diff-hash.test.ts`.

### Modified server files

- `server/session.ts` — add `_walkthrough` field, getter/setter, `toBlob`/`fromBlob`, diff-hash-at-generation capture.
- `server/store.ts` — add `walkthrough` to `ProjectBlob`.
- `server/comment-migration.ts` — pass through `walkthrough` (new field).
- `server/mcp.ts` — add `set_walkthrough` tool.
- `server/app.ts` — add `GET /project/:slug/walkthrough` route.
- `server/__tests__/session.test.ts` — round-trip walkthrough test.
- `server/__tests__/routes.test.ts` — walkthrough endpoint tests.
- `server/__tests__/mcp.test.ts` — `set_walkthrough` tool test.

### New frontend files

- `frontend/src/walkthrough-types.ts` — mirror interfaces for frontend use.
- `frontend/src/walkthrough-api.ts` — `fetchWalkthrough()` client.
- `frontend/src/components/walkthrough/WalkthroughView.tsx` — view shell (top bar + left rail + main).
- `frontend/src/components/walkthrough/StopList.tsx` — left rail.
- `frontend/src/components/walkthrough/Stop.tsx` — current stop (title, narrative, artifacts).
- `frontend/src/components/walkthrough/StopArtifact.tsx` — one file's artifact (header + hunk lines + banner).
- `frontend/src/components/walkthrough/StaleBanner.tsx`.
- `frontend/src/components/walkthrough/EmptyState.tsx`.
- `frontend/src/__tests__/walkthrough-state.test.ts`.

### Modified frontend files

- `frontend/src/state.ts` — `walkthrough`, `walkthroughMode`, `activeStopIdx`, `visitedStops` signals/stores.
- `frontend/src/ProjectView.tsx` — branch on `walkthroughMode()` to render `WalkthroughView`.
- `frontend/src/hooks/useKeyboardShortcuts.ts` — `W`, `d`, `↵`, `⇧↵`, `g<N>` inside walkthrough mode.
- `frontend/src/components/header/Header.tsx` — walkthrough button and progress indicator.
- `frontend/src/components/sidebar/TreeFile.tsx` — stop-coverage badge.
- `frontend/src/style.css` — walkthrough styles.

### New plugin files

- `.claude-plugin/agents/walkthrough-author.md`.
- `skills/walkthrough/SKILL.md`.
- `skills/prepare/SKILL.md`.

### Spec amendment

- `docs/superpowers/specs/2026-04-23-walkthrough-mode-design.md` — change entry key from `w` to `W` (Task 0).

---

## Task 0: Patch the spec for the `w` key conflict

**Files:**
- Modify: `docs/superpowers/specs/2026-04-23-walkthrough-mode-design.md`

- [ ] **Step 1: Change two references to `w` → `W`**

In the "User flow" section, find:
> `3. User presses \`w\` (or clicks the button) to enter walkthrough mode.`

Change to:
> `3. User presses \`W\` (shift-w, since \`w\` is already bound to whole-file view) or clicks the button to enter walkthrough mode.`

In the "Empty state" section, find:
> `Pressing \`w\` or clicking the Walkthrough button`

Change to:
> `Pressing \`W\` or clicking the Walkthrough button`

In the "UI layout" → "Bottom hints" bullet, find `\`W\`` is not yet present, but confirm the keyboard hint line already reads correctly. (The bottom hints bullet does not reference `w`; no change needed there.)

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-23-walkthrough-mode-design.md
git commit -m "docs: walkthrough spec uses W not w (w is taken by whole-file view)"
```

---

## Task 1: Define walkthrough types (server)

**Files:**
- Create: `server/walkthrough-types.ts`

- [ ] **Step 1: Write types**

```ts
// server/walkthrough-types.ts

/** New-side line range within a file, 1-based inclusive start, count of lines. */
export interface HunkRef {
  newStart: number;
  newLines: number;
}

export interface StopArtifact {
  /** Repo-relative file path. */
  file: string;
  /** One or more new-side hunk ranges this artifact covers. */
  hunks: HunkRef[];
  /** Optional inline narrative banner rendered above this artifact. */
  banner?: string;
}

export interface Stop {
  /** Stable id, e.g. "stop-1". */
  id: string;
  /** 1-based position in the walkthrough. */
  order: number;
  title: string;
  /** Markdown-safe paragraph ~30-100 words. */
  narrative: string;
  importance: 'primary' | 'supporting' | 'minor';
  artifacts: StopArtifact[];
}

export interface Walkthrough {
  /** Opening summary paragraph (what this PR is). */
  summary: string;
  /** Ordered list of stops. */
  stops: Stop[];
  /** sha256 hex of the unified diff at generation time. */
  diffHash: string;
  /** ISO 8601 timestamp. */
  generatedAt: string;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build:server
```

Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add server/walkthrough-types.ts
git commit -m "server: walkthrough types"
```

---

## Task 2: Diff-hash utility

**Files:**
- Create: `server/diff-hash.ts`
- Create: `server/__tests__/diff-hash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/diff-hash.test.ts
import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../diff-hash.js';

describe('sha256Hex', () => {
  it('returns 64-char hex', () => {
    expect(sha256Hex('')).toHaveLength(64);
  });

  it('is deterministic', () => {
    expect(sha256Hex('diff --git a/b a/b\n+line')).toBe(sha256Hex('diff --git a/b a/b\n+line'));
  });

  it('differs for different input', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run --config vitest.config.server.ts server/__tests__/diff-hash.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// server/diff-hash.ts
import { createHash } from 'node:crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run --config vitest.config.server.ts server/__tests__/diff-hash.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add server/diff-hash.ts server/__tests__/diff-hash.test.ts
git commit -m "server: sha256Hex helper for diff-hash staleness"
```

---

## Task 3: Walkthrough markdown parser

Authoring format for the agent to write; the server parses it into a `Walkthrough`.

**Format** (documented in the agent prompt in Task 18):

```markdown
## Summary

A short paragraph describing what this PR does.

## Stop 1

- importance: primary
- title: Analyze entry point restructured

Moves the analysis pipeline out of POST /analyze and into its own module...

### Artifact: server/analyze.ts

- hunk: 1-7

### Artifact: server/app.ts

- hunk: 42-48
- banner: The old inline path becomes a thin delegate.

## Stop 2

- importance: supporting
- title: Priority scoring helper

Adds a small pure function for ranking changed files by perceived impact...

### Artifact: server/classifier.ts

- hunk: 12-20
- hunk: 55-58
```

**Files:**
- Create: `server/parse-walkthrough.ts`
- Create: `server/__tests__/parse-walkthrough.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// server/__tests__/parse-walkthrough.test.ts
import { describe, it, expect } from 'vitest';
import { parseWalkthrough } from '../parse-walkthrough.js';

const EXAMPLE = `## Summary

A short overview of the PR.

## Stop 1

- importance: primary
- title: Analyze entry point restructured

Moves the pipeline out of POST /analyze and into its own module.

### Artifact: server/analyze.ts

- hunk: 1-7

### Artifact: server/app.ts

- hunk: 42-48
- banner: The old inline path becomes a thin delegate.

## Stop 2

- importance: supporting
- title: Priority scoring helper

Adds a small pure function for ranking.

### Artifact: server/classifier.ts

- hunk: 12-20
- hunk: 55-58
`;

describe('parseWalkthrough', () => {
  it('parses summary', () => {
    const w = parseWalkthrough(EXAMPLE);
    expect(w.summary).toBe('A short overview of the PR.');
  });

  it('parses stops in order', () => {
    const w = parseWalkthrough(EXAMPLE);
    expect(w.stops).toHaveLength(2);
    expect(w.stops[0].order).toBe(1);
    expect(w.stops[1].order).toBe(2);
    expect(w.stops[0].id).toBe('stop-1');
    expect(w.stops[1].id).toBe('stop-2');
  });

  it('parses stop metadata', () => {
    const [s1] = parseWalkthrough(EXAMPLE).stops;
    expect(s1.importance).toBe('primary');
    expect(s1.title).toBe('Analyze entry point restructured');
    expect(s1.narrative).toBe('Moves the pipeline out of POST /analyze and into its own module.');
  });

  it('parses artifacts with hunks and banner', () => {
    const [s1] = parseWalkthrough(EXAMPLE).stops;
    expect(s1.artifacts).toHaveLength(2);
    expect(s1.artifacts[0]).toEqual({
      file: 'server/analyze.ts',
      hunks: [{ newStart: 1, newLines: 7 }],
    });
    expect(s1.artifacts[1]).toEqual({
      file: 'server/app.ts',
      hunks: [{ newStart: 42, newLines: 7 }],
      banner: 'The old inline path becomes a thin delegate.',
    });
  });

  it('parses multiple hunks for one artifact', () => {
    const [, s2] = parseWalkthrough(EXAMPLE).stops;
    expect(s2.artifacts[0].hunks).toEqual([
      { newStart: 12, newLines: 9 },
      { newStart: 55, newLines: 4 },
    ]);
  });

  it('rejects invalid importance', () => {
    const bad = EXAMPLE.replace('importance: primary', 'importance: bogus');
    expect(() => parseWalkthrough(bad)).toThrow(/importance/i);
  });

  it('rejects missing summary', () => {
    expect(() => parseWalkthrough('## Stop 1\n- importance: primary\n- title: x\n\nfoo')).toThrow(/summary/i);
  });

  it('rejects missing stops', () => {
    expect(() => parseWalkthrough('## Summary\n\nhi')).toThrow(/stop/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run --config vitest.config.server.ts server/__tests__/parse-walkthrough.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the parser**

```ts
// server/parse-walkthrough.ts
import type { Walkthrough, Stop, StopArtifact, HunkRef } from './walkthrough-types.js';

const VALID_IMPORTANCE = new Set(['primary', 'supporting', 'minor']);

/** Parses "12-20" → {newStart:12, newLines:9}. Count is inclusive end − start + 1. */
function parseHunkRange(s: string): HunkRef {
  const m = s.trim().match(/^(\d+)-(\d+)$/);
  if (!m) throw new Error(`Invalid hunk range "${s}"; expected "start-end"`);
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  if (end < start) throw new Error(`Invalid hunk range "${s}"; end < start`);
  return { newStart: start, newLines: end - start + 1 };
}

export function parseWalkthrough(input: string): Walkthrough {
  // Split on top-level "## " headers.
  const sections = input.split(/^## /m).slice(1);
  if (sections.length === 0) throw new Error('Missing ## Summary section');

  let summary = '';
  const stopSections: string[] = [];

  for (const section of sections) {
    const nl = section.indexOf('\n');
    const heading = section.slice(0, nl).trim();
    const body = section.slice(nl + 1).trim();
    if (heading.toLowerCase() === 'summary') {
      summary = body.split('\n\n')[0].trim();
    } else if (/^stop\s+\d+$/i.test(heading)) {
      stopSections.push(section);
    }
  }

  if (!summary) throw new Error('Missing ## Summary section or empty summary');
  if (stopSections.length === 0) throw new Error('Expected at least one ## Stop N section');

  const stops: Stop[] = stopSections.map((section, i) => {
    const nl = section.indexOf('\n');
    const heading = section.slice(0, nl).trim();
    const body = section.slice(nl + 1);

    const orderMatch = heading.match(/^stop\s+(\d+)$/i);
    const order = orderMatch ? parseInt(orderMatch[1], 10) : i + 1;

    // Split stop body into "metadata + narrative" and "### Artifact" sections.
    const parts = body.split(/^### Artifact:/m);
    const preArtifacts = parts[0];
    const artifactSections = parts.slice(1);

    let importance = '';
    let title = '';
    const narrativeLines: string[] = [];
    let pastMetadata = false;
    for (const line of preArtifacts.split('\n')) {
      const trimmed = line.trim();
      if (!pastMetadata && trimmed.startsWith('- importance:')) {
        importance = trimmed.replace('- importance:', '').trim();
      } else if (!pastMetadata && trimmed.startsWith('- title:')) {
        title = trimmed.replace('- title:', '').trim();
      } else if (!pastMetadata && trimmed === '') {
        if (importance && title) pastMetadata = true;
      } else if (pastMetadata && trimmed !== '') {
        narrativeLines.push(trimmed);
      }
    }

    if (!VALID_IMPORTANCE.has(importance)) {
      throw new Error(`Invalid importance "${importance}" in Stop ${order}`);
    }
    if (!title) throw new Error(`Missing title for Stop ${order}`);
    const narrative = narrativeLines.join(' ').trim();
    if (!narrative) throw new Error(`Missing narrative for Stop ${order}`);

    const artifacts: StopArtifact[] = artifactSections.map((raw) => {
      const aNl = raw.indexOf('\n');
      const file = raw.slice(0, aNl).trim();
      if (!file) throw new Error(`Missing file path for artifact in Stop ${order}`);
      const aBody = raw.slice(aNl + 1);

      const hunks: HunkRef[] = [];
      let banner: string | undefined;
      for (const line of aBody.split('\n')) {
        const t = line.trim();
        if (t.startsWith('- hunk:')) {
          hunks.push(parseHunkRange(t.replace('- hunk:', '')));
        } else if (t.startsWith('- banner:')) {
          banner = t.replace('- banner:', '').trim();
        }
      }
      if (hunks.length === 0) throw new Error(`Artifact "${file}" in Stop ${order} has no hunks`);
      const artifact: StopArtifact = { file, hunks };
      if (banner) artifact.banner = banner;
      return artifact;
    });

    if (artifacts.length === 0) throw new Error(`Stop ${order} has no artifacts`);

    return {
      id: `stop-${order}`,
      order,
      title,
      narrative,
      importance: importance as Stop['importance'],
      artifacts,
    };
  });

  return {
    summary,
    stops,
    // diffHash + generatedAt filled in by the MCP tool, not the parser
    diffHash: '',
    generatedAt: '',
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run --config vitest.config.server.ts server/__tests__/parse-walkthrough.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add server/parse-walkthrough.ts server/__tests__/parse-walkthrough.test.ts
git commit -m "server: parse-walkthrough for markdown → Walkthrough"
```

---

## Task 4: Session walkthrough storage

**Files:**
- Modify: `server/session.ts`
- Modify: `server/__tests__/session.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/session.test.ts`:

```ts
// ... existing imports
import type { Walkthrough } from '../walkthrough-types.js';

// inside the existing describe block, add:
describe('walkthrough', () => {
  it('stores and returns a walkthrough', () => {
    const session = new Session({ repoPath: '/tmp', baseBranch: 'main' });
    const w: Walkthrough = {
      summary: 's',
      stops: [{
        id: 'stop-1', order: 1, title: 't', narrative: 'n', importance: 'primary',
        artifacts: [{ file: 'a.ts', hunks: [{ newStart: 1, newLines: 3 }] }],
      }],
      diffHash: 'abc',
      generatedAt: '2026-04-23T00:00:00Z',
    };
    session.setWalkthrough(w);
    expect(session.walkthrough).toEqual(w);
  });

  it('null by default', () => {
    const session = new Session({ repoPath: '/tmp', baseBranch: 'main' });
    expect(session.walkthrough).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run --config vitest.config.server.ts server/__tests__/session.test.ts -t walkthrough
```

Expected: FAIL (`session.setWalkthrough is not a function`).

- [ ] **Step 3: Extend `Session`**

In `server/session.ts`:

Add import near the top alongside existing imports:
```ts
import type { Walkthrough } from './walkthrough-types.js';
```

Add a private field near `_analysis` (around line 49):
```ts
  private _walkthrough: Walkthrough | null = null;
```

Add getter near the existing `get analysis()` (around line 149):
```ts
  get walkthrough(): Walkthrough | null {
    return this._walkthrough;
  }
```

Add setter near `setAnalysis` (around line 196):
```ts
  setWalkthrough(walkthrough: Walkthrough): void {
    this._walkthrough = walkthrough;
    this.persist();
  }

  clearWalkthrough(): void {
    this._walkthrough = null;
    this.persist();
  }
```

Update `toBlob()` to include `walkthrough`:
```ts
  toBlob(): ProjectBlob {
    return {
      // ... existing fields
      walkthrough: this._walkthrough,
    };
  }
```

Update `fromBlob()` to restore:
```ts
  static fromBlob(blob: Record<string, unknown>, outputPath: string): Session {
    // ... existing restoration
    session._walkthrough = (migrated.walkthrough as Walkthrough | null) ?? null;
    return session;
  }
```

- [ ] **Step 4: Update `ProjectBlob` in `server/store.ts`**

Add to the interface (after `analysis`):
```ts
  walkthrough: import('./walkthrough-types.js').Walkthrough | null;
```

- [ ] **Step 5: Update `server/comment-migration.ts`** to pass through

Find the `migrateBlob` function; inspect its return to confirm unknown fields pass through. If it does not (e.g., it constructs a new object with a fixed set of keys), add `walkthrough: blob.walkthrough` to the output. If it spreads, no change needed.

Run:
```bash
grep -n "walkthrough\|return" server/comment-migration.ts | head -20
```

If `walkthrough` is absent and the return is an object literal not using `...blob`, modify to include:
```ts
    walkthrough: blob.walkthrough ?? null,
```
in the return.

- [ ] **Step 6: Run tests**

```bash
npx vitest run --config vitest.config.server.ts server/__tests__/session.test.ts -t walkthrough
```

Expected: 2 passed.

- [ ] **Step 7: Build check + full session tests**

```bash
npm run build:server
npx vitest run --config vitest.config.server.ts server/__tests__/session.test.ts server/__tests__/store.test.ts
```

Expected: no type errors; all session + store tests green.

- [ ] **Step 8: Commit**

```bash
git add server/session.ts server/store.ts server/comment-migration.ts server/__tests__/session.test.ts
git commit -m "server: Session walkthrough storage + ProjectBlob field"
```

---

## Task 5: `set_walkthrough` MCP tool

**Files:**
- Modify: `server/mcp.ts`
- Modify: `server/__tests__/mcp.test.ts`

The tool accepts a markdown-file path (consistent with `set_analysis`'s pattern), parses it, computes the current diff hash, stamps `diffHash` + `generatedAt`, stores it on the session.

- [ ] **Step 1: Write the failing test**

Inspect the existing mcp.test.ts structure first (`grep -n "set_analysis" server/__tests__/mcp.test.ts`). Add a `set_walkthrough` test analogous to the existing `set_analysis` test.

Skeleton (adapt to the file's existing structure):

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// inside describe block:
it('set_walkthrough parses markdown and stores on session', async () => {
  const mdPath = join(tmpDir, 'walkthrough.md');
  writeFileSync(mdPath, `## Summary

Test.

## Stop 1

- importance: primary
- title: Test stop

A short narrative.

### Artifact: a.ts

- hunk: 1-5
`);

  const result = await callMcpTool('set_walkthrough', {
    repoPath: fixture.repoPath,
    walkthroughPath: mdPath,
  });
  const body = JSON.parse(result.content[0].text);
  expect(body.ok).toBe(true);
  expect(body.stopCount).toBe(1);

  const session = manager.findByRepoPath(fixture.repoPath)!.session;
  expect(session.walkthrough).not.toBeNull();
  expect(session.walkthrough!.stops[0].title).toBe('Test stop');
  expect(session.walkthrough!.diffHash).toMatch(/^[a-f0-9]{64}$/);
  expect(session.walkthrough!.generatedAt).toMatch(/^\d{4}-/);
});

it('set_walkthrough returns error on malformed input', async () => {
  const mdPath = join(tmpDir, 'bad.md');
  writeFileSync(mdPath, 'not valid');
  const result = await callMcpTool('set_walkthrough', {
    repoPath: fixture.repoPath,
    walkthroughPath: mdPath,
  });
  const body = JSON.parse(result.content[0].text);
  expect(body.error).toBeDefined();
});
```

(Adapt to whatever helper already exists in this file for calling tools. If none, model it after the `set_analysis` test in the same file — read the file first.)

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run --config vitest.config.server.ts server/__tests__/mcp.test.ts -t set_walkthrough
```

Expected: FAIL (tool not registered).

- [ ] **Step 3: Implement the tool**

In `server/mcp.ts`:

Add imports at the top:
```ts
import { parseWalkthrough } from './parse-walkthrough.js';
import { sha256Hex } from './diff-hash.js';
import { getBranchDiff } from './git-ops.js';
```

Add the tool registration after the `set_analysis` block (around line 200):

```ts
  server.tool(
    'set_walkthrough',
    'Set the narrated walkthrough for a review session. Accepts a markdown file authored by the walkthrough-author agent. The review UI renders this as an ordered walkthrough of logical changes, separate from the diff view. Called by the walkthrough skill after the agent writes its output.',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
      walkthroughPath: z.string().describe('Absolute path to the walkthrough markdown output'),
    },
    async ({ repoPath, walkthroughPath }) => {
      const { found } = resolveProject(manager, repoPath, server);
      try {
        const md = readFileSync(walkthroughPath, 'utf-8');
        const parsed = parseWalkthrough(md);
        const diff = getBranchDiff(found.session.repoPath, found.session.baseBranch);
        parsed.diffHash = sha256Hex(diff);
        parsed.generatedAt = new Date().toISOString();
        found.session.setWalkthrough(parsed);
        found.session.broadcast('walkthrough_changed', { stopCount: parsed.stops.length });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            ok: true,
            stopCount: parsed.stops.length,
            diffHash: parsed.diffHash,
          }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }) }],
        };
      }
    },
  );
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run --config vitest.config.server.ts server/__tests__/mcp.test.ts -t set_walkthrough
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add server/mcp.ts server/__tests__/mcp.test.ts
git commit -m "server: set_walkthrough MCP tool"
```

---

## Task 6: `GET /project/:slug/walkthrough` endpoint

Returns the walkthrough with a computed `stale` flag (compare stored `diffHash` to hash of current diff).

**Files:**
- Modify: `server/app.ts`
- Modify: `server/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the existing describe block in `server/__tests__/routes.test.ts`:

```ts
describe('GET /project/:slug/walkthrough', () => {
  it('returns null when not generated', async () => {
    const res = await request(app).get(`/project/${slug}/walkthrough`).expect(200);
    expect(res.body.walkthrough).toBeNull();
    expect(res.body.stale).toBe(false);
  });

  it('returns walkthrough with stale=false after generation', async () => {
    const session = manager.get(slug)!;
    // Simulate generation against the current diff
    const { getBranchDiff } = await import('../git-ops.js');
    const { sha256Hex } = await import('../diff-hash.js');
    const diff = getBranchDiff(session.repoPath, session.baseBranch);
    session.setWalkthrough({
      summary: 'x',
      stops: [{ id: 'stop-1', order: 1, title: 't', narrative: 'n', importance: 'primary',
        artifacts: [{ file: 'a.ts', hunks: [{ newStart: 1, newLines: 2 }] }] }],
      diffHash: sha256Hex(diff),
      generatedAt: new Date().toISOString(),
    });
    const res = await request(app).get(`/project/${slug}/walkthrough`).expect(200);
    expect(res.body.walkthrough.stops).toHaveLength(1);
    expect(res.body.stale).toBe(false);
  });

  it('returns stale=true when diffHash mismatches', async () => {
    const session = manager.get(slug)!;
    session.setWalkthrough({
      summary: 'x',
      stops: [{ id: 'stop-1', order: 1, title: 't', narrative: 'n', importance: 'primary',
        artifacts: [{ file: 'a.ts', hunks: [{ newStart: 1, newLines: 2 }] }] }],
      diffHash: 'deadbeef',
      generatedAt: new Date().toISOString(),
    });
    const res = await request(app).get(`/project/${slug}/walkthrough`).expect(200);
    expect(res.body.stale).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run --config vitest.config.server.ts server/__tests__/routes.test.ts -t walkthrough
```

Expected: 3 FAIL (route not registered → 404).

- [ ] **Step 3: Add the route**

In `server/app.ts`, after the `/analysis` route (around line 225), add:

```ts
  projectRouter.get('/walkthrough', (_req, res) => {
    const session: Session = res.locals.session;
    const wt = session.walkthrough;
    if (!wt) {
      res.json({ walkthrough: null, stale: false });
      return;
    }
    const currentDiff = getBranchDiff(session.repoPath, session.baseBranch);
    const currentHash = sha256Hex(currentDiff);
    res.json({ walkthrough: wt, stale: currentHash !== wt.diffHash });
  });
```

Add the `sha256Hex` import at the top of `server/app.ts`:
```ts
import { sha256Hex } from './diff-hash.js';
```

(`getBranchDiff` is already imported.)

- [ ] **Step 4: Run tests**

```bash
npx vitest run --config vitest.config.server.ts server/__tests__/routes.test.ts -t walkthrough
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/__tests__/routes.test.ts
git commit -m "server: GET /walkthrough with stale flag"
```

---

## Task 7: Frontend walkthrough types + API client

**Files:**
- Create: `frontend/src/walkthrough-types.ts`
- Create: `frontend/src/walkthrough-api.ts`

- [ ] **Step 1: Mirror server types**

```ts
// frontend/src/walkthrough-types.ts
export interface HunkRef {
  newStart: number;
  newLines: number;
}

export interface StopArtifact {
  file: string;
  hunks: HunkRef[];
  banner?: string;
}

export interface Stop {
  id: string;
  order: number;
  title: string;
  narrative: string;
  importance: 'primary' | 'supporting' | 'minor';
  artifacts: StopArtifact[];
}

export interface Walkthrough {
  summary: string;
  stops: Stop[];
  diffHash: string;
  generatedAt: string;
}

export interface WalkthroughResponse {
  walkthrough: Walkthrough | null;
  stale: boolean;
}
```

- [ ] **Step 2: API client**

First, check how `frontend/src/api.ts` structures the slug-aware fetch:
```bash
grep -n "fetchAnalysis\|fetchItems\|'/analysis'" frontend/src/api.ts | head -10
```

Use the same prefix pattern. Create:

```ts
// frontend/src/walkthrough-api.ts
import type { WalkthroughResponse } from './walkthrough-types';

/**
 * Reuses the /project/:slug prefix from the main api module; we call through
 * a small fetch helper here. If frontend/src/api.ts exposes a prefix helper,
 * switch to that; for now we derive it from window.location.pathname.
 */
function projectPrefix(): string {
  const m = window.location.pathname.match(/^\/project\/([^\/]+)/);
  return m ? `/project/${m[1]}` : '';
}

export async function fetchWalkthrough(): Promise<WalkthroughResponse> {
  const res = await fetch(`${projectPrefix()}/walkthrough`);
  if (!res.ok) throw new Error(`fetchWalkthrough ${res.status}`);
  return res.json();
}
```

(If `frontend/src/api.ts` already provides a `projectPrefix()`-like helper, import it instead. Read the file once to check before writing duplicate logic.)

- [ ] **Step 3: Verify it compiles**

```bash
npm run build:frontend
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/walkthrough-types.ts frontend/src/walkthrough-api.ts
git commit -m "frontend: walkthrough types + API client"
```

---

## Task 8: Frontend walkthrough state

**Files:**
- Modify: `frontend/src/state.ts`
- Create: `frontend/src/__tests__/walkthrough-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/__tests__/walkthrough-state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  walkthrough, setWalkthrough, walkthroughStale, setWalkthroughStale,
  walkthroughMode, setWalkthroughMode, activeStopIdx, setActiveStopIdx,
  visitedStops, markStopVisited,
} from '../state';
import type { Walkthrough } from '../walkthrough-types';

const W: Walkthrough = {
  summary: 's',
  diffHash: 'h',
  generatedAt: '2026-04-23T00:00:00Z',
  stops: [
    { id: 'stop-1', order: 1, title: 'A', narrative: 'na', importance: 'primary',
      artifacts: [{ file: 'a.ts', hunks: [{ newStart: 1, newLines: 3 }] }] },
    { id: 'stop-2', order: 2, title: 'B', narrative: 'nb', importance: 'supporting',
      artifacts: [{ file: 'b.ts', hunks: [{ newStart: 1, newLines: 3 }] }] },
  ],
};

describe('walkthrough state', () => {
  beforeEach(() => {
    setWalkthrough(null);
    setWalkthroughStale(false);
    setWalkthroughMode(false);
    setActiveStopIdx(0);
  });

  it('defaults', () => {
    expect(walkthrough()).toBeNull();
    expect(walkthroughStale()).toBe(false);
    expect(walkthroughMode()).toBe(false);
    expect(activeStopIdx()).toBe(0);
    expect(Object.keys(visitedStops)).toHaveLength(0);
  });

  it('stores walkthrough', () => {
    setWalkthrough(W);
    expect(walkthrough()).toEqual(W);
  });

  it('markStopVisited adds to set', () => {
    markStopVisited('stop-1');
    expect(visitedStops['stop-1']).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run frontend/src/__tests__/walkthrough-state.test.ts
```

Expected: FAIL (exports missing).

- [ ] **Step 3: Add signals to `frontend/src/state.ts`**

At the bottom of the file, add:

```ts
// --- Walkthrough ---

import type { Walkthrough } from './walkthrough-types';

export const [walkthrough, setWalkthrough] = createSignal<Walkthrough | null>(null);
export const [walkthroughStale, setWalkthroughStale] = createSignal(false);
export const [walkthroughMode, setWalkthroughMode] = createSignal(false);
export const [activeStopIdx, setActiveStopIdx] = createSignal(0);

export const [visitedStops, setVisitedStops] = createStore<Record<string, boolean>>({});

export function markStopVisited(id: string): void {
  setVisitedStops(id, true);
}

export function resetVisitedStops(): void {
  for (const k of Object.keys(visitedStops)) setVisitedStops(k, undefined!);
}

/** Reset walkthrough-specific transient state when the walkthrough itself changes. */
export function onWalkthroughReplaced(): void {
  setActiveStopIdx(0);
  resetVisitedStops();
}
```

Move the `import type { Walkthrough }` to the top of the file alongside other imports; don't leave it inline.

- [ ] **Step 4: Run tests**

```bash
npx vitest run frontend/src/__tests__/walkthrough-state.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/state.ts frontend/src/__tests__/walkthrough-state.test.ts
git commit -m "frontend: walkthrough state signals + visited-stops store"
```

---

## Task 9: Walkthrough load + SSE refresh in `ProjectView`

**Files:**
- Modify: `frontend/src/ProjectView.tsx`

- [ ] **Step 1: Wire up initial load**

Read `frontend/src/ProjectView.tsx` first — locate where `fetchAnalysis` or similar initial-data fetches happen.

Add near those fetches:
```ts
import { fetchWalkthrough } from './walkthrough-api';
import { setWalkthrough, setWalkthroughStale, onWalkthroughReplaced } from './state';

async function loadWalkthrough(): Promise<void> {
  try {
    const r = await fetchWalkthrough();
    setWalkthrough(r.walkthrough);
    setWalkthroughStale(r.stale);
    onWalkthroughReplaced();
  } catch {
    setWalkthrough(null);
    setWalkthroughStale(false);
  }
}
```

Call `loadWalkthrough()` in the initial-load sequence (same place analysis is loaded).

- [ ] **Step 2: Handle SSE `walkthrough_changed`**

Locate the SSE event handler in `ProjectView.tsx` (look for `addEventListener` or an EventSource setup). Add a listener:
```ts
source.addEventListener('walkthrough_changed', () => {
  loadWalkthrough();
});
```

Also reload on `git_changed` to re-compute staleness:
```ts
source.addEventListener('git_changed', () => {
  loadWalkthrough();
  // ... anything else that already runs on git_changed
});
```

(If an existing `git_changed` handler exists, add `loadWalkthrough()` to it rather than duplicating.)

- [ ] **Step 3: Verify build**

```bash
npm run build:frontend
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/ProjectView.tsx
git commit -m "frontend: load walkthrough on mount; refresh on SSE"
```

---

## Task 10: `WalkthroughView` shell + sub-components

**Files:**
- Create: `frontend/src/components/walkthrough/WalkthroughView.tsx`
- Create: `frontend/src/components/walkthrough/StopList.tsx`
- Create: `frontend/src/components/walkthrough/Stop.tsx`
- Create: `frontend/src/components/walkthrough/StopArtifact.tsx`
- Create: `frontend/src/components/walkthrough/StaleBanner.tsx`
- Create: `frontend/src/components/walkthrough/EmptyState.tsx`

- [ ] **Step 1: `EmptyState.tsx`**

```tsx
// frontend/src/components/walkthrough/EmptyState.tsx
export function EmptyState() {
  return (
    <div class="wt-empty">
      <p>No walkthrough generated yet.</p>
      <p class="wt-empty-hint">
        Run <code>/lgtm walkthrough</code> (or <code>/lgtm prepare</code> to also analyze) to build one.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: `StaleBanner.tsx`**

```tsx
// frontend/src/components/walkthrough/StaleBanner.tsx
export function StaleBanner() {
  return (
    <div class="wt-stale-banner" role="status">
      Walkthrough out of date — diff has changed since generation.
      Run <code>/lgtm walkthrough</code> to refresh.
    </div>
  );
}
```

- [ ] **Step 3: `StopList.tsx`**

```tsx
// frontend/src/components/walkthrough/StopList.tsx
import { For } from 'solid-js';
import { walkthrough, activeStopIdx, setActiveStopIdx, visitedStops, markStopVisited } from '../../state';

export function StopList() {
  return (
    <aside class="wt-stops">
      <div class="wt-stops-header">Stops</div>
      <For each={walkthrough()?.stops ?? []}>
        {(stop, i) => (
          <div
            class="wt-stop-row"
            classList={{
              'wt-stop-active': i() === activeStopIdx(),
              'wt-stop-visited': !!visitedStops[stop.id] && i() !== activeStopIdx(),
            }}
            onClick={() => { setActiveStopIdx(i()); markStopVisited(stop.id); }}
          >
            <span class="wt-stop-bullet">
              {visitedStops[stop.id] ? '✓' : i() === activeStopIdx() ? '●' : '○'}
            </span>
            <div class="wt-stop-row-body">
              <div class="wt-stop-row-title">{stop.order} · {stop.title}</div>
              <div class="wt-stop-row-files">
                {stop.artifacts.map(a => a.file.split('/').pop()).join(' · ')}
              </div>
            </div>
          </div>
        )}
      </For>
    </aside>
  );
}
```

- [ ] **Step 4: `StopArtifact.tsx`**

```tsx
// frontend/src/components/walkthrough/StopArtifact.tsx
import { For, Show } from 'solid-js';
import { files } from '../../state';
import type { StopArtifact as Artifact } from '../../walkthrough-types';

/** Pick the lines of `files()[path]` whose newLine is in any of the artifact's hunk ranges. */
function linesForArtifact(a: Artifact) {
  const file = files().find((f) => f.path === a.file);
  if (!file) return [];
  return file.lines.filter((ln) => {
    if (ln.newLine == null) return false;
    return a.hunks.some((h) => ln.newLine! >= h.newStart && ln.newLine! < h.newStart + h.newLines);
  });
}

export function StopArtifact(props: { artifact: Artifact }) {
  return (
    <div class="wt-artifact">
      <Show when={props.artifact.banner}>
        <div class="wt-banner">{props.artifact.banner}</div>
      </Show>
      <div class="wt-artifact-header">{props.artifact.file}</div>
      <div class="wt-artifact-lines">
        <For each={linesForArtifact(props.artifact)}>
          {(ln) => (
            <div class={`wt-line wt-line-${ln.type}`}>
              <span class="wt-line-num">{ln.newLine ?? ''}</span>
              <span class="wt-line-content">{ln.content}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
```

Note: for the first cut, we render simple line rows. Later we can swap in the existing `DiffLine` component for comment affordances once we confirm its API.

- [ ] **Step 5: `Stop.tsx`**

```tsx
// frontend/src/components/walkthrough/Stop.tsx
import { For } from 'solid-js';
import { walkthrough, activeStopIdx } from '../../state';
import { StopArtifact } from './StopArtifact';

export function Stop() {
  const current = () => walkthrough()?.stops[activeStopIdx()] ?? null;
  return (
    <main class="wt-stop">
      {current() && (
        <>
          <div class="wt-stop-label">
            Stop {current()!.order} · <span class={`wt-imp-${current()!.importance}`}>{current()!.importance}</span>
          </div>
          <h2 class="wt-stop-title">{current()!.title}</h2>
          <p class="wt-stop-narrative">{current()!.narrative}</p>
          <For each={current()!.artifacts}>{(a) => <StopArtifact artifact={a} />}</For>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 6: `WalkthroughView.tsx`**

```tsx
// frontend/src/components/walkthrough/WalkthroughView.tsx
import { Show } from 'solid-js';
import { walkthrough, walkthroughStale, activeStopIdx, setWalkthroughMode } from '../../state';
import { StopList } from './StopList';
import { Stop } from './Stop';
import { StaleBanner } from './StaleBanner';
import { EmptyState } from './EmptyState';

export function WalkthroughView() {
  const total = () => walkthrough()?.stops.length ?? 0;
  const pct = () => {
    const t = total();
    return t === 0 ? 0 : Math.round(((activeStopIdx() + 1) / t) * 100);
  };
  return (
    <div class="wt-view">
      <div class="wt-topbar">
        <button class="wt-back" onClick={() => setWalkthroughMode(false)}>← Back to diff</button>
        <div class="wt-title">{walkthrough()?.summary.split('.')[0] ?? 'Walkthrough'}</div>
        <div class="wt-progress">
          <Show when={total() > 0} fallback={<span>—</span>}>
            Stop {activeStopIdx() + 1} of {total()} · {pct()}%
          </Show>
        </div>
      </div>
      <Show when={walkthroughStale()}><StaleBanner /></Show>
      <div class="wt-body">
        <Show when={walkthrough()} fallback={<EmptyState />}>
          <StopList />
          <Stop />
        </Show>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Wire into `ProjectView.tsx`**

Find the top-level render return. Add at the top of the content area:

```tsx
import { walkthroughMode } from './state';
import { WalkthroughView } from './components/walkthrough/WalkthroughView';

// in render:
<Show when={walkthroughMode()} fallback={/* existing diff/document view */}>
  <WalkthroughView />
</Show>
```

(Adapt to the existing JSX structure — preserve sidebar and header; only swap the main reading area.)

- [ ] **Step 8: Build**

```bash
npm run build:frontend
```

Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/walkthrough/ frontend/src/ProjectView.tsx
git commit -m "frontend: WalkthroughView shell with stop list, stop, banners"
```

---

## Task 11: Visited-stop tracking + active-stop effect

When `activeStopIdx` changes, mark the now-active stop as visited.

**Files:**
- Modify: `frontend/src/ProjectView.tsx` (or wherever effects are registered)

- [ ] **Step 1: Add effect**

```ts
import { createEffect } from 'solid-js';
import { walkthrough, activeStopIdx, markStopVisited } from './state';

createEffect(() => {
  const w = walkthrough();
  const i = activeStopIdx();
  if (w && w.stops[i]) markStopVisited(w.stops[i].id);
});
```

Place alongside existing effects in the component.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/ProjectView.tsx
git commit -m "frontend: mark active stop as visited via effect"
```

---

## Task 12: Keyboard shortcuts for walkthrough

**Files:**
- Modify: `frontend/src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Add walkthrough-mode branch**

Add imports at the top:
```ts
import {
  walkthroughMode, setWalkthroughMode,
  walkthrough, activeStopIdx, setActiveStopIdx,
} from '../state';
```

At the top of `handler(e)`, before the existing rows logic, add:

```ts
    // Walkthrough-mode keys
    if (walkthroughMode()) {
      const w = walkthrough();
      const len = w?.stops.length ?? 0;
      if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        setWalkthroughMode(false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        setActiveStopIdx(Math.min(activeStopIdx() + 1, Math.max(0, len - 1)));
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        setActiveStopIdx(Math.max(activeStopIdx() - 1, 0));
        return;
      }
      // g<N> jump — simple one-digit jump for now
      if (e.key === 'g') {
        _pendingJump = true;
        return;
      }
      if (_pendingJump && /^[0-9]$/.test(e.key)) {
        const target = parseInt(e.key, 10) - 1;
        if (target >= 0 && target < len) setActiveStopIdx(target);
        _pendingJump = false;
        return;
      }
      _pendingJump = false;
      // Fall through: j/k/etc inside walkthrough still work for scroll (no-op here)
      return;
    }

    // Entering walkthrough from diff mode
    if (e.key === 'W' && !e.metaKey && !e.ctrlKey && walkthrough()) {
      setWalkthroughMode(true);
      return;
    }
```

Declare `_pendingJump` outside the handler (closure-scoped in the hook):
```ts
let _pendingJump = false;
```

- [ ] **Step 2: Write a unit test for the jump logic**

(Optional — pragmatic skip if testing DOM events adds too much setup. The existing `sidebar-keyboard.test.ts` shows the pattern if needed.)

- [ ] **Step 3: Build**

```bash
npm run build:frontend && npm run lint:frontend
```

Expected: exits 0; no lint errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useKeyboardShortcuts.ts
git commit -m "frontend: keyboard shortcuts for walkthrough (W/d/Enter/g)"
```

---

## Task 13: Header walkthrough button + progress

**Files:**
- Modify: `frontend/src/components/header/Header.tsx`

- [ ] **Step 1: Add button**

Read the file first (`grep -n "button\|class=" frontend/src/components/header/Header.tsx`) to find existing controls. Add near them:

```tsx
import { walkthrough, walkthroughMode, setWalkthroughMode, activeStopIdx } from '../../state';

// inside the header JSX, alongside existing controls:
<Show when={walkthrough()}>
  <button
    class="header-btn"
    classList={{ 'header-btn-active': walkthroughMode() }}
    onClick={() => setWalkthroughMode(!walkthroughMode())}
    title="Walkthrough (W)"
  >
    Walkthrough
    <Show when={walkthroughMode()}>
      <span class="header-btn-progress">
        {' '}{activeStopIdx() + 1}/{walkthrough()!.stops.length}
      </span>
    </Show>
  </button>
</Show>
```

- [ ] **Step 2: Build + visual check**

```bash
npm run dev:all
```

Open in browser, confirm button appears when walkthrough exists and toggles mode.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/header/Header.tsx
git commit -m "frontend: walkthrough button + progress in header"
```

---

## Task 14: Stop-coverage badges in sidebar file rows

**Files:**
- Modify: `frontend/src/components/sidebar/TreeFile.tsx`

- [ ] **Step 1: Derive covering stops per file**

Add a memo in `frontend/src/state.ts`:

```ts
export const stopsByFile = createMemo<Record<string, number[]>>(() => {
  const out: Record<string, number[]> = {};
  const w = walkthrough();
  if (!w) return out;
  for (const stop of w.stops) {
    for (const a of stop.artifacts) {
      if (!out[a.file]) out[a.file] = [];
      out[a.file].push(stop.order);
    }
  }
  return out;
});
```

- [ ] **Step 2: Render the badge**

In `frontend/src/components/sidebar/TreeFile.tsx`, import `stopsByFile`, `setActiveStopIdx`, `setWalkthroughMode`, `walkthrough`. Render a small badge when `stopsByFile()[filePath]` exists:

```tsx
<Show when={stopsByFile()[file.path]?.length}>
  <span
    class="wt-file-badge"
    onClick={(e) => {
      e.stopPropagation();
      const ids = stopsByFile()[file.path];
      const w = walkthrough();
      if (!w || !ids.length) return;
      const idx = w.stops.findIndex(s => s.order === ids[0]);
      if (idx >= 0) setActiveStopIdx(idx);
      setWalkthroughMode(true);
    }}
    title={`Walkthrough stop${stopsByFile()[file.path].length > 1 ? 's' : ''} ${stopsByFile()[file.path].join(', ')}`}
  >
    ◆{stopsByFile()[file.path].join(',')}
  </span>
</Show>
```

Place it adjacent to existing badges/indicators on the file row.

- [ ] **Step 3: Build**

```bash
npm run build:frontend
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/sidebar/TreeFile.tsx frontend/src/state.ts
git commit -m "frontend: stop-coverage badges on sidebar file rows"
```

---

## Task 15: CSS for walkthrough view

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Append walkthrough styles**

Append (adjust colors to match existing custom properties; inspect `:root { --bg: ...; }` in `style.css` first):

```css
/* --- Walkthrough --- */
.wt-view { display: flex; flex-direction: column; height: 100%; }
.wt-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px; background: var(--bg-sidebar, #14141b);
  border-bottom: 1px solid var(--border, #2a2a38); font-size: 12px;
}
.wt-back {
  background: none; border: none; color: var(--text, #cfcfd8);
  cursor: pointer; font: inherit; padding: 0;
}
.wt-title { color: var(--text, #fff); font-weight: 600; }
.wt-progress { color: var(--text-dim, #9a9aa8); }

.wt-stale-banner {
  padding: 8px 14px; background: rgba(232, 170, 51, 0.12);
  border-bottom: 1px solid rgba(232, 170, 51, 0.3); color: #e8aa33; font-size: 12px;
}

.wt-body { display: flex; flex: 1; overflow: hidden; }

.wt-stops {
  flex: 0 0 220px; background: var(--bg, #10101a);
  border-right: 1px solid var(--border, #1e1e28);
  padding: 14px 8px; font-size: 11px; overflow-y: auto;
}
.wt-stops-header {
  color: var(--text-dim, #7f7f8a); font-size: 10px;
  letter-spacing: 0.6px; text-transform: uppercase; padding: 0 8px 8px;
}
.wt-stop-row {
  padding: 7px 10px; margin: 2px 0; border-radius: 3px;
  display: flex; gap: 8px; cursor: pointer; color: var(--text, #cfcfd8);
}
.wt-stop-row:hover { background: rgba(255,255,255,0.03); }
.wt-stop-active { background: rgba(122,170,221,0.1); border-left: 2px solid var(--accent, #7ad); }
.wt-stop-visited { color: var(--text-dim, #5f5f70); }
.wt-stop-bullet { color: var(--text-dim, #7f7f8a); font-family: monospace; }
.wt-stop-row-title { font-weight: 500; }
.wt-stop-row-files { font-size: 10px; opacity: 0.6; margin-top: 2px; }

.wt-stop { flex: 1; overflow-y: auto; padding: 20px 26px; }
.wt-stop-label {
  font-size: 10px; color: var(--accent, #7ad);
  letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 6px;
}
.wt-stop-title { color: var(--text, #fff); margin: 0 0 12px; font-size: 19px; font-weight: 600; }
.wt-stop-narrative { color: var(--text, #cfcfd8); line-height: 1.55; font-size: 13px; margin-bottom: 20px; }

.wt-artifact { margin-bottom: 12px; border: 1px solid var(--border, #1e1e28); border-radius: 4px; overflow: hidden; }
.wt-artifact-header {
  background: var(--bg-sidebar, #1a1a24); padding: 6px 12px;
  font-size: 11px; color: var(--text-dim, #9a9aa8); font-family: monospace;
}
.wt-artifact-lines { padding: 6px 0; font-family: monospace; font-size: 11px; }
.wt-line { display: flex; gap: 10px; padding: 0 12px; line-height: 1.55; }
.wt-line-add { color: #6f9f6a; }
.wt-line-del { color: #c77777; }
.wt-line-context { color: var(--text-dim, #8a8a98); }
.wt-line-num { width: 40px; text-align: right; color: var(--text-dim, #5f5f70); }

.wt-banner {
  background: rgba(122,170,221,0.08); border-left: 2px solid var(--accent, #7ad);
  padding: 8px 14px; margin: 14px 0 10px; font-size: 12px; color: var(--text, #cfcfd8);
}

.wt-imp-primary { color: #e8aa33; }
.wt-imp-supporting { color: var(--accent, #7ad); }
.wt-imp-minor { color: var(--text-dim, #7f7f8a); }

.wt-file-badge {
  display: inline-block; margin-left: 6px; padding: 1px 5px;
  font-size: 10px; color: var(--accent, #7ad); background: rgba(122,170,221,0.1);
  border-radius: 3px; cursor: pointer;
}
.wt-file-badge:hover { background: rgba(122,170,221,0.2); }

.wt-empty { padding: 40px; text-align: center; color: var(--text-dim, #9a9aa8); }
.wt-empty-hint { font-size: 12px; margin-top: 8px; }

.header-btn-active { background: rgba(122,170,221,0.18); }
.header-btn-progress { font-size: 11px; opacity: 0.7; }
```

- [ ] **Step 2: Visual QA**

```bash
npm run dev:all
```

Open browser, enter walkthrough mode (need a walkthrough in the DB — for now, manually seed one via the MCP tool or the `set_walkthrough` tool from a test session). Confirm layout matches the mockup in `.superpowers/brainstorm/*/content/walkthrough-view.html`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css
git commit -m "css: walkthrough view styling"
```

---

## Task 16: `walkthrough-author` agent

**Files:**
- Create: `.claude-plugin/agents/walkthrough-author.md`

- [ ] **Step 1: Write the agent file**

```md
---
name: walkthrough-author
description: Authors a narrated walkthrough of a code-review diff. Given a repo path, base branch, and output file path, inspects the diff and writes an ordered set of logical-change "stops" with titles, narratives, and artifact references. Use when building a walkthrough for an LGTM review session.
tools: Bash, Read, Grep, Glob
---

# Walkthrough Author

Your job: read the diff between HEAD and the base branch of a git repo, identify the substantive logical changes, and write a walkthrough markdown file describing each as a narrated "stop."

## Inputs

The calling skill will tell you:
- `REPO_PATH` — absolute path to the git repo
- `BASE_BRANCH` — base branch to diff against (e.g. `origin/main`)
- `OUTPUT_PATH` — absolute path to write the walkthrough markdown

## Process

1. Use `git diff --no-color BASE_BRANCH..HEAD` to read the full diff.
2. Scan for logical changes. A logical change is a coherent unit of work that a reviewer would want to understand as one thing, even if it touches several files. Examples: "new caching helper", "refactored the analyze entry point", "added X field to Y type and its call sites."
3. Filter out trivial changes — pure formatting, unused-import removal, comment-only edits, isolated typo fixes. These do NOT need stops. The walkthrough is a reading lens, not total coverage.
4. Order the stops to minimize comprehension cost: foundations first (new types, new files), then the code that uses them, then call sites and consumers. If the change is better explained as an execution trace, follow the control flow.
5. For each stop, write:
   - a short imperative title (≤ 60 chars)
   - a narrative paragraph (30–100 words) explaining what changed AND why — the reader is good at system-mapping but slow on line-by-line, so front-load the intent
   - one or more artifacts (files + line ranges on the NEW side of the diff)
   - optional per-artifact `banner` to bridge between artifacts with a short connective sentence
6. Tag each stop with `importance: primary | supporting | minor`. Use `primary` sparingly (~1–3 per walkthrough) for the core change(s). `supporting` for derived or related changes. `minor` for small but non-trivial edits that still benefit from narration.

## Output format

Write to `OUTPUT_PATH` using this exact format:

```
## Summary

<one-paragraph overview of what this PR is, 1–3 sentences>

## Stop 1

- importance: primary
- title: <short title>

<narrative paragraph>

### Artifact: <repo-relative file path>

- hunk: <newStart>-<newEnd>

### Artifact: <another file>

- hunk: <newStart>-<newEnd>
- banner: <optional bridging sentence>

## Stop 2

...
```

`hunk: 42-55` means new-side lines 42 through 55 inclusive. Multiple `- hunk:` lines per artifact are allowed when one logical change spans discontiguous ranges in the same file.

## Quality checks before finishing

- Does every stop reference at least one artifact? (Required.)
- Does every artifact have at least one `- hunk:` line? (Required.)
- Are new-side line ranges within the actual diff? Don't invent lines.
- Is the overall story legible if a reader reads stops in order?
- Did you avoid narrating trivial cosmetic changes? (Good — they belong in diff view, not here.)
- Reality check on length: 3–8 stops is typical. A 1-stop walkthrough means you probably bundled too much; a 20-stop walkthrough means you probably narrated trivia.

Write the file to `OUTPUT_PATH` and exit.
```

- [ ] **Step 2: Commit**

```bash
git add .claude-plugin/agents/walkthrough-author.md
git commit -m "agent: walkthrough-author"
```

---

## Task 17: `/lgtm walkthrough` skill

**Files:**
- Create: `skills/walkthrough/SKILL.md`

- [ ] **Step 1: Write the skill**

```md
---
name: walkthrough
description: >
  Generate a narrated walkthrough for an LGTM review session. Produces an ordered
  sequence of logical-change stops with titles, narratives, and artifact references.
  Use when the user asks to build a walkthrough, or when /lgtm prepare chains into
  this skill.
allowed-tools: "mcp__lgtm__set_walkthrough,mcp__plugin_lgtm_lgtm__set_walkthrough,Agent,Bash(git:*)"
---

# Walkthrough Skill

Generate a narrated walkthrough for an active LGTM review session. Calls the
`walkthrough-author` agent which writes a markdown file, then `set_walkthrough`
parses and submits it.

## Prerequisites

None. `set_walkthrough` auto-registers the project if needed. If you want the
review UI claimed for notifications, call `claim_reviews` separately (via the
`lgtm` skill). Walkthrough is independent of analysis — it can run with or
without `/lgtm analyze` having been run first.

## Pipeline

### Step 1: Find the base branch

1. First try `gh pr view --json baseRefName -q .baseRefName`. If it succeeds,
   fetch it with `git fetch origin <branch>` and use `origin/<branch>` as base.
2. Otherwise fall back to `main` (or `master` if `main` doesn't exist).

### Step 2: Author

Spawn the `walkthrough-author` agent. Pass:

```
REPO_PATH: <repo path>
BASE_BRANCH: <base branch>
OUTPUT_PATH: /tmp/lgtm-walkthrough.md
```

### Step 3: Submit

Call `set_walkthrough` with:
- `repoPath`: the repo path
- `walkthroughPath`: `/tmp/lgtm-walkthrough.md`

If the tool returns an error (parse failure, validation error), read the file to
diagnose, ask the agent to fix, and retry.

On success, tell the user how many stops were generated and that the walkthrough
is available in the review UI (press `W`).
```

- [ ] **Step 2: Commit**

```bash
git add skills/walkthrough/SKILL.md
git commit -m "skill: /lgtm walkthrough"
```

---

## Task 18: `/lgtm prepare` skill

**Files:**
- Create: `skills/prepare/SKILL.md`

- [ ] **Step 1: Write the skill**

```md
---
name: prepare
description: >
  Generate full review preparation for an LGTM session: classification (analyze)
  + narrated walkthrough. Convenience skill that chains /lgtm analyze and
  /lgtm walkthrough. Use when the user asks to prepare a review, or wants
  everything ready before opening the UI.
---

# Prepare Skill

Run both analysis and walkthrough generation for an active LGTM review session.

## Pipeline

### Step 1: Analyze

Invoke the `analyze` skill. Follow its full pipeline (file-classifier + synthesizer
agents, then `set_analysis`).

### Step 2: Walkthrough

Invoke the `walkthrough` skill. Follow its full pipeline (walkthrough-author agent,
then `set_walkthrough`).

## On errors

If `/lgtm analyze` fails, stop and report. Don't attempt walkthrough — it's
independent, but running it while analysis is broken surfaces more confusion
than it solves.

If `/lgtm walkthrough` fails after analysis succeeded, report the walkthrough
error and note that analysis is complete and usable on its own.
```

- [ ] **Step 2: Commit**

```bash
git add skills/prepare/SKILL.md
git commit -m "skill: /lgtm prepare (chain analyze + walkthrough)"
```

---

## Task 19: Full integration smoke test

**Files:**
- None (manual run)

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all green.

- [ ] **Step 2: Lint + format**

```bash
npm run lint
npm run format:check
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev:all
```

On a branch with real changes:
1. Run `/lgtm walkthrough` in a Claude Code session pointing at this repo.
2. Open the review UI.
3. Confirm the "Walkthrough" button appears in the header.
4. Press `W`. Confirm the walkthrough view renders with stops on the left.
5. Navigate with `↵` / `⇧↵`. Confirm active-stop highlight moves; visited stops get checkmarks.
6. Post a comment inside walkthrough view. Press `d` to return to diff. Confirm the same comment appears in diff view.
7. Add a commit to the branch. Refresh UI (or let SSE trigger). Confirm stale banner appears.
8. Run `/lgtm walkthrough` again. Confirm stale banner disappears.
9. Click a `◆` badge on a sidebar file row. Confirm it jumps into walkthrough mode at the right stop.
10. Press `g` then `2`. Confirm it jumps to Stop 2.
11. With no walkthrough generated: delete the DB row (or use a fresh project), press `W`. Confirm empty state shows.

- [ ] **Step 4: If anything is broken**

Diagnose and fix. Add a regression test where the failure could recur. Commit the fix with `git commit -m "fix: <what>"`.

- [ ] **Step 5: Final commit (only if smoke-test fixes were made)**

Whatever fix was needed.

---

## Out of scope (reminder)

Per the spec, these are explicitly deferred:

- Live Q&A about a stop (conversational sidebar).
- Executable diffs / inline test output.
- Walkthrough chapters / nested stops.
- Per-hunk (vs. per-file) badges in diff view.
- Multi-walkthrough / alternative orderings.
- Resilient hunk references across diff changes (stale walkthroughs degrade; regeneration is the fix).
- Total coverage (walkthrough is a reading lens, not a full-review gate).

---

## Self-review checklist (for the plan author)

Run this after the plan is complete; fix inline as needed.

**Spec coverage:**
- [x] Stop + Walkthrough data model → Task 1
- [x] Diff-hash staleness → Tasks 2, 6
- [x] Markdown parser → Task 3
- [x] Session storage → Task 4
- [x] MCP `set_walkthrough` → Task 5
- [x] `GET /walkthrough` → Task 6
- [x] Frontend state + API → Tasks 7, 8, 9
- [x] WalkthroughView + sub-components → Task 10
- [x] Visited-stop tracking → Task 11
- [x] Keyboard shortcuts → Task 12
- [x] Header button + progress → Task 13
- [x] Sidebar badges → Task 14
- [x] Styling → Task 15
- [x] `walkthrough-author` agent → Task 16
- [x] `/lgtm walkthrough` skill → Task 17
- [x] `/lgtm prepare` skill → Task 18
- [x] Empty state → covered in Task 10
- [x] Staleness banner → covered in Task 10 + 15
- [x] Comment sharing → existing comment system works unchanged; no walkthrough-specific comment code needed
- [x] Spec key-conflict patch → Task 0

**Placeholder scan:** None detected. Each step has concrete code or a concrete command.

**Type consistency:**
- `Walkthrough`, `Stop`, `StopArtifact`, `HunkRef` are defined once in `server/walkthrough-types.ts` and mirrored verbatim in `frontend/src/walkthrough-types.ts`. Field names match.
- `setWalkthrough` / `walkthrough` getter use identical names on both server (`Session`) and frontend (signal).
- `set_walkthrough` tool payload field: `walkthroughPath` — referenced consistently in MCP tool (Task 5) and skill (Task 17).
