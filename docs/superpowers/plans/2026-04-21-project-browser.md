# Project Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user browse between registered LGTM projects from one window — via a landing page at `/` and a Cmd-K palette anywhere inside a project view.

**Architecture:** Server enriches `GET /projects` with per-project live state (branch, PR, comment counts). Frontend `App.tsx` becomes a thin router: no slug → `<LandingPage>`, slug → `<ProjectView>` (which holds everything currently in `App`). Palette mounts inside `ProjectView`; opens on Cmd-K or via a new switcher button in the header. Full-page reload on project switch — existing code is already slug-scoped.

**Tech Stack:** Node/Express + vitest/supertest on the server; SolidJS + Vite + vitest on the frontend. No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-04-21-project-browser-design.md`

---

## File layout

**Modified:**
- `server/app.ts` — enrich `GET /projects` handler
- `server/__tests__/routes.test.ts` — new test cases for enriched fields + repo-missing
- `frontend/src/App.tsx` — reduce to a thin router
- `frontend/src/api.ts` — export `getProjectSlug`; add `fetchRegisteredProjects`, `deregisterProject`; new `ProjectSummary` type
- `frontend/src/state.ts` — add `paletteOpen` signal
- `frontend/src/hooks/useKeyboardShortcuts.ts` — Cmd-K handler; metaKey guard on bare `k`
- `frontend/src/components/header/Header.tsx` — switcher button
- `frontend/src/style.css` — landing + palette styles

**New:**
- `frontend/src/ProjectView.tsx` — everything that was in `App` body
- `frontend/src/components/landing/LandingPage.tsx`
- `frontend/src/components/palette/ProjectPalette.tsx`
- `frontend/src/components/palette/filter.ts` — pure subsequence filter (testable in isolation)
- `frontend/src/__tests__/palette-filter.test.ts`

Run `npm run build` from repo root (never from `frontend/`). Run tests with `npm test` (or `npm run test:server` / `npm run test:frontend`). Commit messages stay single-line.

---

## Task 1: Server — enrich `GET /projects` (happy path)

**Files:**
- Modify: `server/app.ts:38-40`
- Test: `server/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

In `server/__tests__/routes.test.ts`, extend the existing `describe('project management', ...)` block — add this test after the existing `GET /projects` test (around line 65):

```ts
it('GET /projects returns enriched fields for a fresh project', async () => {
  const res = await request(app)
    .get('/projects')
    .expect(200);
  const project = res.body.projects.find((p: { slug: string }) => p.slug === slug);
  expect(project).toBeDefined();
  expect(project.repoName).toBe(require('node:path').basename(fixture.repoPath));
  expect(project.branch).toBe('feature');
  expect(project.baseBranch).toBe('main');
  expect(project.pr).toBeNull();
  expect(project.claudeCommentCount).toBe(0);
  expect(project.userCommentCount).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/routes.test.ts -t "enriched fields"`
Expected: FAIL — the properties `repoName`, `branch`, etc. are undefined on the response.

- [ ] **Step 3: Implement the enrichment**

First, update the import from `node:path` at the top of `server/app.ts` to include `basename`. The current import reads:

```ts
import { dirname, join } from 'node:path';
```

Change it to:

```ts
import { basename, dirname, join } from 'node:path';
```

Then replace the `GET /projects` handler (currently lines 38-40):

```ts
app.get('/projects', (_req, res) => {
  const projects = manager.list().map((p) => {
    const session = manager.get(p.slug)!;

    let branch: string | null = null;
    let baseBranch = session.baseBranch;
    let pr: { number: number; url: string } | null = null;
    let repoName = basename(p.repoPath);
    try {
      const meta = getRepoMeta(session.repoPath, session.baseBranch);
      branch = meta.branch;
      baseBranch = meta.baseBranch;
      repoName = meta.repoName;
      if (meta.pr) pr = { number: meta.pr.number, url: meta.pr.url };
    } catch {
      // repo missing or git failed — branch stays null
    }

    const topLevel = session
      .listComments()
      .filter((c) => c.parentId == null && c.status !== 'dismissed');
    const claudeCommentCount = topLevel.filter((c) => c.author === 'claude').length;
    const userCommentCount = topLevel.filter((c) => c.author === 'user').length;

    return { ...p, repoName, branch, baseBranch, pr, claudeCommentCount, userCommentCount };
  });
  res.json({ projects });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/routes.test.ts -t "enriched fields"`
Expected: PASS.

Also run the existing suite to make sure nothing else broke:
Run: `npm run test:server`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/__tests__/routes.test.ts
git commit -m "feat(server): enrich GET /projects with branch, PR, comment counts"
```

---

## Task 2: Server — count comments by status and parent

**Files:**
- Test: `server/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the same `describe('project management', ...)` block:

```ts
it('GET /projects counts include active+resolved, exclude dismissed and replies', async () => {
  // Set up four comments in a known state
  const mk = async (body: object) => {
    const r = await request(app).post(`/project/${slug}/comments`).send(body).expect(200);
    return r.body.comment.id;
  };
  const a1 = await mk({ author: 'user', text: 'active user', item: 'diff' });
  const a2 = await mk({ author: 'user', text: 'will resolve', item: 'diff' });
  const a3 = await mk({ author: 'user', text: 'will dismiss', item: 'diff' });
  const a4 = await mk({ author: 'claude', text: 'claude top', item: 'diff' });
  await mk({ author: 'user', text: 'reply', item: 'diff', parentId: a1 });

  await request(app).patch(`/project/${slug}/comments/${a2}`).send({ status: 'resolved' }).expect(200);
  await request(app).patch(`/project/${slug}/comments/${a3}`).send({ status: 'dismissed' }).expect(200);

  const res = await request(app).get('/projects').expect(200);
  const project = res.body.projects.find((p: { slug: string }) => p.slug === slug);
  // 3 user top-level not-dismissed (a1 active, a2 resolved) — wait, a3 is dismissed (excluded). Count = 2.
  expect(project.userCommentCount).toBe(2);
  expect(project.claudeCommentCount).toBe(1);

  // Cleanup so later tests in the file see the original state
  for (const id of [a1, a2, a3, a4]) {
    await request(app).delete(`/project/${slug}/comments/${id}`).expect(200);
  }
});
```

- [ ] **Step 2: Run test to verify it passes**

The implementation from Task 1 should already satisfy this — the test exists to lock the semantics.

Run: `npx vitest run server/__tests__/routes.test.ts -t "counts include active"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/routes.test.ts
git commit -m "test(server): lock comment-count semantics in GET /projects"
```

---

## Task 3: Server — graceful degradation when repo directory is gone

**Files:**
- Test: `server/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the same `describe('project management', ...)` block:

```ts
it('GET /projects returns branch:null when the repo directory is missing', async () => {
  // Register a second project in a temp dir, then delete the dir
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const tmp = mkdtempSync(join(tmpdir(), 'lgtm-gone-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: tmp });
  execFileSync('git', ['config', 'user.email', 'x@y.z'], { cwd: tmp });
  execFileSync('git', ['config', 'user.name', 'x'], { cwd: tmp });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: tmp });

  const reg = await request(app).post('/projects').send({ repoPath: tmp }).expect(200);
  const goneSlug = reg.body.slug;

  // Remove the directory out from under the session
  rmSync(tmp, { recursive: true, force: true });

  const res = await request(app).get('/projects').expect(200);
  const gone = res.body.projects.find((p: { slug: string }) => p.slug === goneSlug);
  expect(gone).toBeDefined();
  expect(gone.branch).toBeNull();
  expect(gone.pr).toBeNull();
  // Counts still work — they don't touch git
  expect(gone.userCommentCount).toBe(0);
  expect(gone.claudeCommentCount).toBe(0);

  manager.deregister(goneSlug);
});
```

- [ ] **Step 2: Run test to verify it passes**

The Task 1 implementation's try/catch already handles this.

Run: `npx vitest run server/__tests__/routes.test.ts -t "branch:null when"`
Expected: PASS.

If the test fails because `detectBaseBranch` or similar throws at an unexpected point, trace the stack and widen the try/catch block to wrap any git-calling code. Do not swallow unrelated errors — only the git calls.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/routes.test.ts
git commit -m "test(server): GET /projects handles missing repo directory"
```

---

## Task 4: Frontend API — types, helpers, `getProjectSlug` export

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Edit `api.ts`**

At the top of `frontend/src/api.ts`, change the `getProjectSlug` declaration from module-private to exported:

```ts
// was: function getProjectSlug(): string {
export function getProjectSlug(): string {
  const match = window.location.pathname.match(/^\/project\/([^/]+)/);
  return match?.[1] ?? '';
}
```

Add a new exported interface near the other `interface` declarations (after `interface ErrorData`):

```ts
export interface ProjectSummary {
  slug: string;
  repoPath: string;
  description: string;
  repoName: string;
  branch: string | null;
  baseBranch: string;
  pr: { number: number; url: string } | null;
  claudeCommentCount: number;
  userCommentCount: number;
}
```

Append two new helper functions at the end of the file. These hit root-level routes, so they do **not** use `baseUrl()`:

```ts
export async function fetchRegisteredProjects(): Promise<ProjectSummary[]> {
  const resp = await fetch('/projects');
  const data = await checkedJson<{ projects?: ProjectSummary[] }>(resp);
  return data.projects ?? [];
}

export async function deregisterProject(slug: string): Promise<void> {
  const resp = await fetch(`/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  await checkedJson<{ ok: boolean }>(resp);
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run build:frontend`
Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat(frontend): export getProjectSlug; add project-registry helpers"
```

---

## Task 5: Frontend state — `paletteOpen` signal

**Files:**
- Modify: `frontend/src/state.ts`

- [ ] **Step 1: Edit `state.ts`**

Add a line immediately after the existing `symbolSearchOpen` signal (around line 129):

```ts
export const [paletteOpen, setPaletteOpen] = createSignal(false);
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run build:frontend`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/state.ts
git commit -m "feat(frontend): add paletteOpen signal"
```

---

## Task 6: Frontend — palette fuzzy filter (pure function + tests)

**Files:**
- Create: `frontend/src/components/palette/filter.ts`
- Create: `frontend/src/__tests__/palette-filter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/palette-filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterProjects } from '../components/palette/filter';
import type { ProjectSummary } from '../api';

const FIXTURES: ProjectSummary[] = [
  {
    slug: 'claude-review',
    repoPath: '/Users/tom/dev/claude-review',
    repoName: 'claude-review',
    description: 'LGTM tool',
    branch: 'main',
    baseBranch: 'main',
    pr: null,
    claudeCommentCount: 0,
    userCommentCount: 0,
  },
  {
    slug: 'plugin-dev',
    repoPath: '/Users/tom/dev/plugin-dev',
    repoName: 'plugin-dev',
    description: '',
    branch: 'main',
    baseBranch: 'main',
    pr: null,
    claudeCommentCount: 0,
    userCommentCount: 0,
  },
  {
    slug: 'anthology',
    repoPath: '/Users/tom/dev/anthology',
    repoName: 'anthology',
    description: 'Content pipeline',
    branch: 'feature',
    baseBranch: 'main',
    pr: null,
    claudeCommentCount: 2,
    userCommentCount: 0,
  },
];

describe('filterProjects', () => {
  it('returns full list for empty or whitespace query', () => {
    expect(filterProjects(FIXTURES, '')).toHaveLength(3);
    expect(filterProjects(FIXTURES, '   ')).toHaveLength(3);
  });

  it('matches subsequence case-insensitively across repoName and slug', () => {
    const out = filterProjects(FIXTURES, 'CLREV');
    expect(out.map((p) => p.slug)).toEqual(['claude-review']);
  });

  it('matches against description', () => {
    const out = filterProjects(FIXTURES, 'pipeline');
    expect(out.map((p) => p.slug)).toEqual(['anthology']);
  });

  it('matches against repoPath', () => {
    const out = filterProjects(FIXTURES, 'plugin');
    expect(out.map((p) => p.slug)).toEqual(['plugin-dev']);
  });

  it('returns empty when no project matches', () => {
    expect(filterProjects(FIXTURES, 'zzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/__tests__/palette-filter.test.ts`
Expected: FAIL — module `../components/palette/filter` does not exist.

- [ ] **Step 3: Implement the filter**

Create `frontend/src/components/palette/filter.ts`:

```ts
import type { ProjectSummary } from '../../api';

export function filterProjects(projects: ProjectSummary[], query: string): ProjectSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return projects;
  return projects.filter((p) => {
    const haystack = `${p.repoName} ${p.slug} ${p.repoPath} ${p.description}`.toLowerCase();
    let cursor = 0;
    for (const ch of q) {
      const idx = haystack.indexOf(ch, cursor);
      if (idx === -1) return false;
      cursor = idx + 1;
    }
    return true;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/__tests__/palette-filter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/palette/filter.ts frontend/src/__tests__/palette-filter.test.ts
git commit -m "feat(frontend): subsequence filter for project palette"
```

---

## Task 7: Frontend — extract `ProjectView` from `App`

This task is a refactor only — no behavior changes. `App.tsx` today has ~340 lines of project-scoped logic (onMount, SSE, loaders, keyboard shortcuts, JSX). We move all of that into a new `ProjectView` component so the soon-to-be-added `LandingPage` branch in `App` doesn't trigger it on `/`.

**Files:**
- Create: `frontend/src/ProjectView.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create `ProjectView.tsx`**

Create `frontend/src/ProjectView.tsx` containing the **current** contents of `App.tsx`, with two changes:

1. Rename `export default function App()` to `export default function ProjectView()`.
2. Namespace the `lgtm-active-item` localStorage key by slug. Find the two references in the current `App.tsx`:

   ```ts
   localStorage.setItem('lgtm-active-item', itemId);
   ```
   ```ts
   const savedItem = localStorage.getItem('lgtm-active-item');
   ```

   Replace both with slug-scoped keys. At the top of `ProjectView` (right after the `const [commitPanelOpen...]` line), add:

   ```ts
   const activeItemKey = `lgtm-active-item:${getProjectSlug()}`;
   ```

   Import `getProjectSlug` from `./api`. Then change the two lines to:

   ```ts
   localStorage.setItem(activeItemKey, itemId);
   ```
   ```ts
   const savedItem = localStorage.getItem(activeItemKey);
   ```

All other imports, handlers, and JSX move over unchanged. Do not add or remove features in this task.

- [ ] **Step 2: Shrink `App.tsx` to a router**

Replace the entire contents of `frontend/src/App.tsx` with:

```tsx
import { getProjectSlug } from './api';
import ProjectView from './ProjectView';
import LandingPage from './components/landing/LandingPage';

export default function App() {
  if (!getProjectSlug()) return <LandingPage />;
  return <ProjectView />;
}
```

- [ ] **Step 3: Stub `LandingPage` so the build still compiles**

Create `frontend/src/components/landing/LandingPage.tsx`:

```tsx
export default function LandingPage() {
  return <div class="landing-empty">Landing page (coming soon).</div>;
}
```

This is a stub — Task 8 fills it in.

- [ ] **Step 4: Verify build and manual smoke**

Run: `npm run build`
Expected: build succeeds.

Run: `npm run dev:all`
Visit `http://127.0.0.1:9900/project/<any-registered-slug>/`
Expected: existing project view works exactly as before — diff loads, comments load, SSE connects, keyboard shortcuts work. Check that `lgtm-active-item:<slug>` is the key in DevTools → Application → Local Storage (not `lgtm-active-item`).

Visit `http://127.0.0.1:9900/`
Expected: the "Landing page (coming soon)." stub renders. No console errors about 404s from `/items`, `/events`, etc.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/ProjectView.tsx frontend/src/components/landing/LandingPage.tsx
git commit -m "refactor(frontend): split App into ProjectView + router; namespace active-item by slug"
```

---

## Task 8: Frontend — `LandingPage` component + styles

**Files:**
- Modify: `frontend/src/components/landing/LandingPage.tsx`
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Implement `LandingPage`**

Replace the stub in `frontend/src/components/landing/LandingPage.tsx`:

```tsx
import { createResource, createSignal, For, Show } from 'solid-js';
import { fetchRegisteredProjects, deregisterProject, type ProjectSummary } from '../../api';

export default function LandingPage() {
  const [projects, { refetch }] = createResource(fetchRegisteredProjects);
  const [confirming, setConfirming] = createSignal<string | null>(null);

  function open(slug: string) {
    window.location.href = `/project/${encodeURIComponent(slug)}/`;
  }

  async function remove(slug: string) {
    await deregisterProject(slug);
    setConfirming(null);
    refetch();
  }

  return (
    <div class="landing">
      <div class="landing-header">
        <h1>LGTM</h1>
        <div class="landing-subtitle">Registered projects</div>
      </div>
      <Show when={projects()} fallback={<div class="landing-empty">Loading…</div>}>
        {(list) => (
          <Show
            when={list().length > 0}
            fallback={
              <div class="landing-empty">
                No projects registered yet. Run the MCP <code>start</code> tool from a project to register it.
              </div>
            }
          >
            <div class="landing-grid">
              <For each={list()}>
                {(p) => <ProjectCard
                  project={p}
                  confirming={confirming() === p.slug}
                  onOpen={() => open(p.slug)}
                  onRequestRemove={() => setConfirming(p.slug)}
                  onCancelRemove={() => setConfirming(null)}
                  onConfirmRemove={() => remove(p.slug)}
                />}
              </For>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}

interface CardProps {
  project: ProjectSummary;
  confirming: boolean;
  onOpen: () => void;
  onRequestRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}

function ProjectCard(props: CardProps) {
  const p = () => props.project;
  const missing = () => p().branch === null;

  return (
    <div class="landing-card" classList={{ missing: missing() }}>
      <div
        class="landing-card-body"
        onClick={() => { if (!missing()) props.onOpen(); }}
        role={missing() ? undefined : 'button'}
      >
        <div class="landing-card-title">{p().repoName}</div>
        <div class="landing-card-branch">
          <Show when={missing()} fallback={<>{p().branch} → {p().baseBranch}</>}>
            <em>(repo missing)</em>
          </Show>
          <Show when={p().pr}>
            {(pr) => <a class="landing-card-pr" href={pr().url} target="_blank" onClick={(e) => e.stopPropagation()}>PR #{pr().number}</a>}
          </Show>
        </div>
        <div class="landing-card-counts">
          <span classList={{ 'count-muted': p().userCommentCount === 0 }}>{p().userCommentCount} drafted</span>
          {' · '}
          <span classList={{ 'count-muted': p().claudeCommentCount === 0 }}>{p().claudeCommentCount} from Claude</span>
        </div>
        <Show when={p().description}>
          <div class="landing-card-description">{p().description}</div>
        </Show>
        <div class="landing-card-path">{p().repoPath}</div>
      </div>
      <div class="landing-card-actions">
        <Show
          when={props.confirming}
          fallback={
            <button
              class="landing-card-remove"
              aria-label="Remove project"
              onClick={(e) => { e.stopPropagation(); props.onRequestRemove(); }}
            >×</button>
          }
        >
          <span class="landing-card-confirm-text">Remove?</span>
          <button
            class="landing-card-confirm-yes"
            onClick={(e) => { e.stopPropagation(); props.onConfirmRemove(); }}
          >Yes</button>
          <button
            class="landing-card-confirm-no"
            onClick={(e) => { e.stopPropagation(); props.onCancelRemove(); }}
          >No</button>
        </Show>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add landing styles**

Append to `frontend/src/style.css`:

```css
.landing {
  max-width: 960px;
  margin: 0 auto;
  padding: 48px 24px;
}
.landing-header {
  margin-bottom: 32px;
}
.landing-header h1 {
  margin: 0 0 4px 0;
  font-size: 28px;
}
.landing-subtitle {
  color: var(--text-muted);
  font-size: 14px;
}
.landing-empty {
  color: var(--text-muted);
  padding: 32px 0;
  font-size: 14px;
}
.landing-empty code {
  background: var(--bg-secondary);
  padding: 1px 6px;
  border-radius: 3px;
}
.landing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
.landing-card {
  position: relative;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 16px;
  transition: border-color 0.12s;
}
.landing-card:hover {
  border-color: var(--accent);
}
.landing-card.missing {
  opacity: 0.6;
}
.landing-card.missing:hover {
  border-color: var(--border);
}
.landing-card-body {
  cursor: pointer;
}
.landing-card.missing .landing-card-body {
  cursor: default;
}
.landing-card-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
}
.landing-card-branch {
  color: var(--text-muted);
  font-size: 12px;
  margin-bottom: 8px;
}
.landing-card-pr {
  margin-left: 8px;
  color: var(--accent);
  text-decoration: none;
}
.landing-card-pr:hover {
  text-decoration: underline;
}
.landing-card-counts {
  font-size: 13px;
  margin-bottom: 8px;
}
.landing-card-counts .count-muted {
  color: var(--text-muted);
}
.landing-card-description {
  color: var(--text);
  font-size: 13px;
  margin-bottom: 8px;
}
.landing-card-path {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  color: var(--text-muted);
}
.landing-card-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.landing-card-remove {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s;
  padding: 0 4px;
  line-height: 1;
}
.landing-card:hover .landing-card-remove {
  opacity: 1;
}
.landing-card-remove:hover {
  color: var(--text);
}
.landing-card-confirm-text {
  color: var(--text-muted);
}
.landing-card-confirm-yes,
.landing-card-confirm-no {
  background: none;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
}
.landing-card-confirm-yes:hover {
  border-color: var(--accent);
  color: var(--accent);
}
```

- [ ] **Step 3: Manual smoke**

Run: `npm run dev:all`
Visit `http://127.0.0.1:9900/`
Expected: cards render for each registered project, counts show, branch + PR visible where applicable, clicking a card navigates to `/project/<slug>/`, hover shows ×, clicking × swaps to Yes/No, clicking Yes removes the project and the card disappears.

For the repo-missing state: `mv` one of your registered project directories aside temporarily, reload `/`, confirm the card shows `(repo missing)` and clicking the body does nothing. Move it back when done.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/landing/LandingPage.tsx frontend/src/style.css
git commit -m "feat(frontend): project browser landing page"
```

---

## Task 9: Frontend — `ProjectPalette` component + styles

**Files:**
- Create: `frontend/src/components/palette/ProjectPalette.tsx`
- Modify: `frontend/src/style.css`
- Modify: `frontend/src/ProjectView.tsx` (mount it)

- [ ] **Step 1: Implement `ProjectPalette`**

Create `frontend/src/components/palette/ProjectPalette.tsx`:

```tsx
import { createEffect, createSignal, For, Show } from 'solid-js';
import { paletteOpen, setPaletteOpen } from '../../state';
import { fetchRegisteredProjects, deregisterProject, getProjectSlug, type ProjectSummary } from '../../api';
import { filterProjects } from './filter';

export default function ProjectPalette() {
  const [projects, setProjects] = createSignal<ProjectSummary[]>([]);
  const [query, setQuery] = createSignal('');
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [confirming, setConfirming] = createSignal<string | null>(null);
  let inputRef: HTMLInputElement | undefined;
  let backdropRef: HTMLDivElement | undefined;

  const currentSlug = () => getProjectSlug();
  const matches = () => filterProjects(projects(), query());

  createEffect(() => {
    if (paletteOpen()) {
      setQuery('');
      setSelectedIdx(0);
      setConfirming(null);
      fetchRegisteredProjects().then(setProjects).catch(() => setProjects([]));
      queueMicrotask(() => inputRef?.focus());
    }
  });

  function close() {
    setPaletteOpen(false);
  }

  function activate(p: ProjectSummary) {
    if (p.slug === currentSlug()) { close(); return; }
    if (p.branch === null) return;
    window.location.href = `/project/${encodeURIComponent(p.slug)}/`;
  }

  async function remove(slug: string) {
    await deregisterProject(slug);
    setConfirming(null);
    const fresh = await fetchRegisteredProjects();
    setProjects(fresh);
    if (slug === currentSlug()) {
      window.location.href = '/';
      return;
    }
    setSelectedIdx((i) => Math.min(i, Math.max(0, fresh.length - 1)));
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const rows = matches();
    if (!rows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[selectedIdx()];
      if (row) activate(row);
    }
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === backdropRef) close();
  }

  return (
    <Show when={paletteOpen()}>
      <div class="project-palette-backdrop" ref={backdropRef} onClick={onBackdropClick}>
        <div class="project-palette-dialog" onKeyDown={onKeyDown}>
          <input
            ref={inputRef}
            type="text"
            class="project-palette-input"
            placeholder="Switch project…"
            value={query()}
            onInput={(e) => { setQuery(e.currentTarget.value); setSelectedIdx(0); }}
          />
          <Show
            when={matches().length > 0}
            fallback={<div class="project-palette-empty">{projects().length === 0 ? 'No projects registered yet.' : 'No matches.'}</div>}
          >
            <div class="project-palette-results">
              <For each={matches()}>
                {(p, i) => (
                  <div
                    class="project-palette-row"
                    classList={{
                      selected: i() === selectedIdx(),
                      current: p.slug === currentSlug(),
                      missing: p.branch === null,
                    }}
                    onMouseEnter={() => setSelectedIdx(i())}
                    onClick={() => activate(p)}
                  >
                    <span class="project-palette-row-name">{p.repoName}</span>
                    <span class="project-palette-row-meta">
                      <Show when={p.branch} fallback={<em>(repo missing)</em>}>
                        {p.branch}
                      </Show>
                      <Show when={p.slug === currentSlug()}>
                        {' '}<span class="project-palette-row-current">(current)</span>
                      </Show>
                    </span>
                    <span class="project-palette-row-counts">
                      <Show when={p.userCommentCount > 0}>{p.userCommentCount}d </Show>
                      <Show when={p.claudeCommentCount > 0}>{p.claudeCommentCount}c</Show>
                    </span>
                    <span class="project-palette-row-actions">
                      <Show
                        when={confirming() === p.slug}
                        fallback={
                          <button
                            class="project-palette-row-remove"
                            aria-label="Remove project"
                            onClick={(e) => { e.stopPropagation(); setConfirming(p.slug); }}
                          >×</button>
                        }
                      >
                        <button class="project-palette-row-yes" onClick={(e) => { e.stopPropagation(); remove(p.slug); }}>Yes</button>
                        <button class="project-palette-row-no" onClick={(e) => { e.stopPropagation(); setConfirming(null); }}>No</button>
                      </Show>
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div class="project-palette-footer">
            &uarr;&darr; navigate &middot; Enter open &middot; Esc close
          </div>
        </div>
      </div>
    </Show>
  );
}
```

- [ ] **Step 2: Mount it inside `ProjectView`**

In `frontend/src/ProjectView.tsx`, add the import near the existing `SymbolSearch` import:

```ts
import ProjectPalette from './components/palette/ProjectPalette';
```

In the returned JSX, add `<ProjectPalette />` as a sibling to `<SymbolSearch />` (the bottom of the fragment).

- [ ] **Step 3: Add palette styles**

Append to `frontend/src/style.css`:

```css
.project-palette-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 1000;
  display: flex;
  justify-content: center;
  padding-top: 15vh;
}
.project-palette-dialog {
  width: 90vw;
  max-width: 600px;
  max-height: 70vh;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  align-self: flex-start;
}
.project-palette-input {
  background: var(--bg);
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-size: 14px;
  padding: 12px 16px;
  outline: none;
}
.project-palette-input::placeholder {
  color: var(--text-muted);
}
.project-palette-results {
  overflow-y: auto;
  flex: 1;
}
.project-palette-row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 12px;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  border-left: 2px solid transparent;
}
.project-palette-row.selected {
  background: var(--hover);
  border-left-color: var(--accent);
}
.project-palette-row.current {
  color: var(--text-muted);
}
.project-palette-row.missing {
  opacity: 0.6;
  cursor: default;
}
.project-palette-row-name {
  font-weight: 600;
}
.project-palette-row-meta {
  color: var(--text-muted);
  font-size: 12px;
}
.project-palette-row-current {
  color: var(--text-muted);
}
.project-palette-row-counts {
  color: var(--text-muted);
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
.project-palette-row-actions {
  display: flex;
  gap: 4px;
}
.project-palette-row-remove {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  opacity: 0;
  padding: 0 4px;
  line-height: 1;
}
.project-palette-row:hover .project-palette-row-remove,
.project-palette-row.selected .project-palette-row-remove {
  opacity: 1;
}
.project-palette-row-remove:hover {
  color: var(--text);
}
.project-palette-row-yes,
.project-palette-row-no {
  background: none;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
}
.project-palette-row-yes:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.project-palette-footer {
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
}
.project-palette-empty {
  padding: 16px;
  color: var(--text-muted);
  text-align: center;
  font-size: 13px;
}
```

- [ ] **Step 4: Manual smoke**

Palette has no keyboard shortcut yet (Task 10). To test, open the browser devtools in a project view and run `window.dispatchEvent(new Event('__test-palette'))` — or simpler, just wait for Task 10 and test then. You can also flip `paletteOpen(true)` by editing `state.ts` temporarily. Minimum check: run `npm run build` and confirm no type errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/palette/ProjectPalette.tsx frontend/src/style.css frontend/src/ProjectView.tsx
git commit -m "feat(frontend): project switcher palette"
```

---

## Task 10: Frontend — Cmd-K keybind; guard bare `k`

**Files:**
- Modify: `frontend/src/hooks/useKeyboardShortcuts.ts`
- Modify: `frontend/src/ProjectView.tsx` (pass new option)

- [ ] **Step 1: Extend `useKeyboardShortcuts`**

In `frontend/src/hooks/useKeyboardShortcuts.ts`, add `onOpenPalette` to the `Options` interface:

```ts
interface Options {
  onRefresh: () => void;
  onToggleCommits: () => void;
  onJumpComment: (direction: 'next' | 'prev') => void;
  onSymbolSearch: () => void;
  onOpenPalette: () => void;
}
```

In `handler(e)`, add a new branch at the top (before the existing `j` / `k` branches) for Cmd-K / Ctrl-K:

```ts
if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
  e.preventDefault();
  options.onOpenPalette();
  return;
}
```

In the existing `else if (e.key === 'k' || e.key === 'ArrowUp')` branch, add a metaKey/ctrlKey guard so Cmd-K no longer triggers prev-file navigation:

```ts
} else if ((e.key === 'k' || e.key === 'ArrowUp') && !e.metaKey && !e.ctrlKey) {
```

- [ ] **Step 2: Wire it up in `ProjectView`**

In `frontend/src/ProjectView.tsx`, find the `useKeyboardShortcuts({...})` call and add the new option. Also import `setPaletteOpen` from `./state`:

```ts
import { /* existing imports, */ setPaletteOpen, paletteOpen } from './state';

// …

useKeyboardShortcuts({
  onRefresh: handleRefresh,
  onToggleCommits: () => setCommitPanelOpen(!commitPanelOpen()),
  onJumpComment: jumpToComment,
  onSymbolSearch: () => setSymbolSearchOpen(!symbolSearchOpen()),
  onOpenPalette: () => setPaletteOpen(!paletteOpen()),
});
```

- [ ] **Step 3: Manual smoke**

Run: `npm run dev:all`
Visit `http://127.0.0.1:9900/project/<any-slug>/`
- Press Cmd-K → palette opens, input focused, project list populates, fuzzy filter works as you type.
- Press Esc → palette closes.
- Press Cmd-K with palette open → (no-op or toggles — acceptable). Press bare `k` on the diff view → prev-file navigation still works.
- Click × on a row → Yes/No. Click No → cancels. Click Yes → project removed.
- Arrow keys move highlight; Enter navigates to the selected project.
- Navigate to a project that isn't the current one → full page reload into that project.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useKeyboardShortcuts.ts frontend/src/ProjectView.tsx
git commit -m "feat(frontend): Cmd-K opens project palette; guard bare k"
```

---

## Task 11: Frontend — header switcher button

**Files:**
- Modify: `frontend/src/components/header/Header.tsx`
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Replace repo name `<strong>` with a button**

In `frontend/src/components/header/Header.tsx`, import `setPaletteOpen`:

```ts
import { repoMeta, files, reviewedFiles, userCommentCount, activeItemId, sessionItems, setPaletteOpen } from '../../state';
```

Inside the `<h1>`, replace:

```tsx
<strong>{meta().repoName || 'Code Review'}</strong>{' '}
```

with:

```tsx
<button class="header-project-btn" onClick={() => setPaletteOpen(true)} title="Switch project (Cmd-K)">
  <strong>{meta().repoName || 'Code Review'}</strong>
  <span class="header-project-chevron">&#9662;</span>
</button>{' '}
```

- [ ] **Step 2: Add styles**

Append to `frontend/src/style.css`:

```css
.header-project-btn {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.header-project-btn:hover {
  color: var(--accent);
}
.header-project-chevron {
  font-size: 10px;
  color: var(--text-muted);
}
.header-project-btn:hover .header-project-chevron {
  color: var(--accent);
}
```

- [ ] **Step 3: Manual smoke**

Run: `npm run dev:all`
Visit a project. Confirm the repo name in the header is now a button with a chevron; hover shows the accent color; clicking opens the palette.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/header/Header.tsx frontend/src/style.css
git commit -m "feat(frontend): header repo name opens project palette"
```

---

## Task 12: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass (server + frontend).

- [ ] **Step 2: Run typecheck + build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Manual end-to-end**

Run: `npm run dev:all`

Verify each of these:
- `/` with no projects registered → empty-state help.
- `/` with projects registered → cards render, counts, branch, PR, description all show. Click card → enters project.
- Inside a project → `Cmd-K` opens palette; type to fuzzy-filter; arrows + Enter navigate; Esc closes.
- Header repo name is a button; clicking opens the palette.
- Delete a project from the palette × → confirm → gone from list on refetch.
- Delete the current project from the palette → lands on `/`.
- Delete a project from a landing card → gone on refetch.
- `lgtm-active-item:<slug>` key exists in localStorage, not the global `lgtm-active-item`.
- Move a registered repo directory aside → card/row shows `(repo missing)`, open action is disabled, × still works. Move it back.

- [ ] **Step 4: Mark complete in TODO.md**

Add a line under `## Content management` (or a new `## Navigation` section) in `TODO.md`:

```
- [x] Browse between registered projects from one window — landing page at `/`, Cmd-K palette, header switcher
```

- [ ] **Step 5: Commit**

```bash
git add TODO.md
git commit -m "docs: mark project-browser complete in TODO"
```
