# Analysis Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pre-review analysis layer that gives the sidebar file grouping, priority ordering, per-file summaries, and an overview banner — making large PRs navigable.

**Architecture:** Claude POSTs analysis JSON to the server before the review starts. The server stores it on the Session object. The frontend fetches it on load and uses it to enrich the sidebar (three view modes: flat/grouped/phased) and add an overview banner. Everything degrades gracefully when no analysis exists.

**Tech Stack:** Python/FastAPI backend, vanilla TypeScript frontend, vitest for frontend tests, pytest for backend tests.

**Spec:** `docs/superpowers/specs/2026-03-31-analysis-layer-design.md`

---

### File Structure

**Backend:**
- Modify: `server.py` — add `POST /analysis`, `GET /analysis` routes, store analysis on Session

**Frontend:**
- Modify: `frontend/src/api.ts` — add `fetchAnalysis()` and `Analysis` type
- Modify: `frontend/src/state.ts` — add `Analysis` types and state, setter
- Create: `frontend/src/analysis.ts` — analysis-aware sidebar rendering (grouped view, phased view, overview banner, file header summaries)
- Modify: `frontend/src/ui.ts` — integrate view toggle, wire analysis into existing `renderFileList`, delegate to analysis module when active
- Modify: `frontend/src/main.ts` — fetch analysis on init
- Modify: `frontend/src/persistence.ts` — persist sidebar view mode
- Modify: `frontend/index.html` — add overview banner element
- Modify: `frontend/src/style.css` — styles for priority indicators, view toggle, groups, phases, overview banner

**Tests:**
- Modify: `tests/test_session.py` — tests for analysis storage/retrieval
- Create: `frontend/src/__tests__/analysis.test.ts` — tests for sorting, grouping, phasing logic

---

### Task 1: Backend — Analysis Storage and API

**Files:**
- Modify: `server.py`
- Modify: `tests/test_session.py`

- [ ] **Step 1: Write failing tests for analysis storage**

Add to `tests/test_session.py`:

```python
def test_set_analysis(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    analysis = {
        'overview': 'Test PR overview',
        'reviewStrategy': 'Review auth first',
        'files': {
            'auth.py': {
                'priority': 'critical',
                'phase': 'review',
                'summary': 'Core auth logic',
                'category': 'core logic',
            }
        },
        'groups': [
            {'name': 'Auth', 'files': ['auth.py']},
        ],
    }
    s.set_analysis(analysis)
    assert s.analysis == analysis


def test_get_analysis_default_none(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    assert s.analysis is None


def test_set_analysis_replaces(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    s.set_analysis({'overview': 'v1', 'reviewStrategy': '', 'files': {}, 'groups': []})
    s.set_analysis({'overview': 'v2', 'reviewStrategy': '', 'files': {}, 'groups': []})
    assert s.analysis['overview'] == 'v2'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/tom/dev/claude-review && python -m pytest tests/test_session.py -v -k "analysis"`
Expected: FAIL — `Session` has no `set_analysis` or `analysis`

- [ ] **Step 3: Implement analysis storage on Session**

In `server.py`, add to the `Session.__init__` method:

```python
self._analysis: dict | None = None
```

Add these methods to `Session`:

```python
# --- Queries ---
@property
def analysis(self) -> dict | None:
    return self._analysis

# --- Mutations ---
def set_analysis(self, analysis: dict) -> None:
    self._analysis = analysis
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/tom/dev/claude-review && python -m pytest tests/test_session.py -v -k "analysis"`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Add API routes**

In `server.py`, add after the existing `POST /submit` route:

```python
@app.post('/analysis')
async def post_analysis(body: dict):
    session.set_analysis(body)
    print(f"ANALYSIS_SET files={len(body.get('files', {}))}", flush=True)
    return {'ok': True}


@app.get('/analysis')
async def get_analysis():
    return {'analysis': session.analysis}
```

- [ ] **Step 6: Run all backend tests**

Run: `cd /Users/tom/dev/claude-review && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add server.py tests/test_session.py
git commit -m "add analysis storage and API endpoints"
```

---

### Task 2: Frontend — Types, State, and API Client

**Files:**
- Modify: `frontend/src/state.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/persistence.ts`

- [ ] **Step 1: Add analysis types to state.ts**

Add these type definitions after the existing `Commit` interface:

```typescript
export interface FileAnalysis {
  priority: 'critical' | 'important' | 'normal' | 'low';
  phase: 'review' | 'skim' | 'rubber-stamp';
  summary: string;
  category: string;
}

export interface AnalysisGroup {
  name: string;
  description?: string;
  files: string[];
}

export interface Analysis {
  overview: string;
  reviewStrategy: string;
  files: Record<string, FileAnalysis>;
  groups: AnalysisGroup[];
}

export type SidebarView = 'flat' | 'grouped' | 'phased';
```

Add to the mutable state section:

```typescript
export let analysis: Analysis | null = null;
export let sidebarView: SidebarView = 'flat';
```

Add setters:

```typescript
export function setAnalysis(a: Analysis | null) { analysis = a; }
export function setSidebarView(v: SidebarView) { sidebarView = v; }
```

- [ ] **Step 2: Add fetchAnalysis to api.ts**

Add to `frontend/src/api.ts`:

```typescript
import type { Analysis } from './state';

export async function fetchAnalysis(): Promise<Analysis | null> {
  const resp = await fetch('/analysis');
  const data = await resp.json();
  return data.analysis || null;
}
```

(Also add `Analysis` to the existing `import type` from `'./state'`.)

- [ ] **Step 3: Persist sidebar view mode**

In `frontend/src/persistence.ts`, add `sidebarView` to the `PersistedState` interface:

```typescript
interface PersistedState {
  comments: Record<string, string>;
  reviewedFiles: string[];
  resolvedComments: string[];
  sidebarView?: string;
}
```

In `saveState`, add to the state object:

```typescript
import { comments, reviewedFiles, resolvedComments, sidebarView } from './state';

// Inside saveState, add to the state object:
sidebarView,
```

In `loadState`, add after the `resolvedComments` block:

```typescript
import { setSidebarView, type SidebarView } from './state';

// Inside loadState:
if (state.sidebarView && ['flat', 'grouped', 'phased'].includes(state.sidebarView)) {
  setSidebarView(state.sidebarView as SidebarView);
}
```

- [ ] **Step 4: Verify build passes**

Run: `cd /Users/tom/dev/claude-review/frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/state.ts frontend/src/api.ts frontend/src/persistence.ts
git commit -m "add analysis types, API client, and view mode persistence"
```

---

### Task 3: Frontend — Analysis-Aware Sidebar Logic (Pure Functions)

**Files:**
- Create: `frontend/src/analysis.ts`
- Create: `frontend/src/__tests__/analysis.test.ts`

- [ ] **Step 1: Write failing tests for sort and grouping logic**

Create `frontend/src/__tests__/analysis.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { sortFilesByPriority, groupFiles, phaseFiles } from '../analysis';
import type { DiffFile, Analysis } from '../state';

function makeFile(path: string): DiffFile {
  return { path, additions: 10, deletions: 5, lines: [] };
}

const ANALYSIS: Analysis = {
  overview: 'Test overview',
  reviewStrategy: 'Test strategy',
  files: {
    'core.ts': { priority: 'critical', phase: 'review', summary: 'Core logic', category: 'core' },
    'utils.ts': { priority: 'normal', phase: 'skim', summary: 'Utility helpers', category: 'util' },
    'types.ts': { priority: 'low', phase: 'rubber-stamp', summary: 'Type exports', category: 'types' },
    'auth.ts': { priority: 'important', phase: 'review', summary: 'Auth check', category: 'core' },
  },
  groups: [
    { name: 'Core', files: ['core.ts', 'auth.ts'] },
    { name: 'Support', files: ['utils.ts'] },
  ],
};

const FILES = [
  makeFile('utils.ts'),
  makeFile('types.ts'),
  makeFile('core.ts'),
  makeFile('auth.ts'),
  makeFile('unknown.ts'),
];

describe('sortFilesByPriority', () => {
  it('sorts files by priority order: critical > important > normal > low', () => {
    const sorted = sortFilesByPriority(FILES, ANALYSIS);
    expect(sorted.map(f => f.path)).toEqual([
      'core.ts', 'auth.ts', 'utils.ts', 'types.ts', 'unknown.ts',
    ]);
  });

  it('preserves diff order within same priority', () => {
    const analysis: Analysis = {
      ...ANALYSIS,
      files: {
        'a.ts': { priority: 'normal', phase: 'skim', summary: '', category: '' },
        'b.ts': { priority: 'normal', phase: 'skim', summary: '', category: '' },
      },
    };
    const files = [makeFile('b.ts'), makeFile('a.ts')];
    const sorted = sortFilesByPriority(files, analysis);
    expect(sorted.map(f => f.path)).toEqual(['b.ts', 'a.ts']);
  });

  it('puts unanalyzed files at the end', () => {
    const sorted = sortFilesByPriority(FILES, ANALYSIS);
    expect(sorted[sorted.length - 1].path).toBe('unknown.ts');
  });
});

describe('groupFiles', () => {
  it('groups files by analysis groups', () => {
    const groups = groupFiles(FILES, ANALYSIS);
    expect(groups.map(g => g.name)).toEqual(['Core', 'Support', 'Other']);
  });

  it('puts ungrouped files in Other', () => {
    const groups = groupFiles(FILES, ANALYSIS);
    const other = groups.find(g => g.name === 'Other')!;
    expect(other.files.map(f => f.path)).toContain('types.ts');
    expect(other.files.map(f => f.path)).toContain('unknown.ts');
  });

  it('omits Other group when all files are grouped', () => {
    const allGrouped: Analysis = {
      ...ANALYSIS,
      groups: [
        { name: 'All', files: ['core.ts', 'auth.ts', 'utils.ts', 'types.ts', 'unknown.ts'] },
      ],
    };
    const groups = groupFiles(FILES, allGrouped);
    expect(groups.map(g => g.name)).toEqual(['All']);
  });
});

describe('phaseFiles', () => {
  it('partitions files into three phases', () => {
    const phases = phaseFiles(FILES, ANALYSIS);
    expect(phases.review.map(f => f.path)).toEqual(['core.ts', 'auth.ts']);
    expect(phases.skim.map(f => f.path)).toEqual(['utils.ts']);
    expect(phases['rubber-stamp'].map(f => f.path)).toEqual(['types.ts']);
  });

  it('puts unanalyzed files in skim', () => {
    const phases = phaseFiles(FILES, ANALYSIS);
    expect(phases.skim.map(f => f.path)).toContain('unknown.ts');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/tom/dev/claude-review/frontend && npx vitest run src/__tests__/analysis.test.ts`
Expected: FAIL — module `../analysis` doesn't export these functions

- [ ] **Step 3: Implement the pure functions**

Create `frontend/src/analysis.ts`:

```typescript
import type { DiffFile, Analysis, FileAnalysis } from './state';

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  important: 1,
  normal: 2,
  low: 3,
};

export interface FileGroup {
  name: string;
  description?: string;
  files: DiffFile[];
}

export function sortFilesByPriority(files: DiffFile[], analysis: Analysis): DiffFile[] {
  return [...files].sort((a, b) => {
    const pa = analysis.files[a.path]?.priority;
    const pb = analysis.files[b.path]?.priority;
    const oa = pa ? PRIORITY_ORDER[pa] : 4;
    const ob = pb ? PRIORITY_ORDER[pb] : 4;
    if (oa !== ob) return oa - ob;
    return files.indexOf(a) - files.indexOf(b);
  });
}

export function groupFiles(files: DiffFile[], analysis: Analysis): FileGroup[] {
  const grouped = new Set<string>();
  const result: FileGroup[] = [];

  for (const group of analysis.groups) {
    const groupFiles = group.files
      .map(path => files.find(f => f.path === path))
      .filter((f): f is DiffFile => f != null);
    if (groupFiles.length > 0) {
      result.push({ name: group.name, description: group.description, files: groupFiles });
      for (const f of groupFiles) grouped.add(f.path);
    }
  }

  const ungrouped = files.filter(f => !grouped.has(f.path));
  if (ungrouped.length > 0) {
    result.push({ name: 'Other', files: ungrouped });
  }

  return result;
}

export interface PhasedFiles {
  review: DiffFile[];
  skim: DiffFile[];
  'rubber-stamp': DiffFile[];
}

export function phaseFiles(files: DiffFile[], analysis: Analysis): PhasedFiles {
  const result: PhasedFiles = { review: [], skim: [], 'rubber-stamp': [] };
  for (const file of files) {
    const phase = analysis.files[file.path]?.phase ?? 'skim';
    result[phase].push(file);
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/tom/dev/claude-review/frontend && npx vitest run src/__tests__/analysis.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/analysis.ts frontend/src/__tests__/analysis.test.ts
git commit -m "add pure functions for priority sorting, grouping, and phasing"
```

---

### Task 4: Frontend — Overview Banner

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/style.css`
- Modify: `frontend/src/ui.ts`

- [ ] **Step 1: Add overview banner HTML element**

In `frontend/index.html`, add after the description-banner div:

```html
<div class="overview-banner" id="overview-banner" style="display:none">
  <div class="overview-content">
    <div class="overview-text" id="overview-text"></div>
    <div class="overview-strategy" id="overview-strategy"></div>
  </div>
  <button class="overview-toggle" id="overview-toggle" title="Toggle overview">&#9650;</button>
</div>
```

- [ ] **Step 2: Add overview banner styles**

Add to `frontend/src/style.css`:

```css
/* --- Overview banner --- */
.overview-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 20px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  line-height: 1.5;
}
.overview-banner.collapsed .overview-content {
  display: none;
}
.overview-banner.collapsed .overview-toggle {
  transform: rotate(180deg);
}
.overview-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.overview-text {
  color: var(--text);
}
.overview-strategy {
  color: var(--text-muted);
  font-style: italic;
}
.overview-toggle {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 10px;
  padding: 2px 6px;
  flex-shrink: 0;
  transition: transform 0.15s;
}
.overview-toggle:hover {
  color: var(--text);
}
```

- [ ] **Step 3: Wire up the overview banner in ui.ts**

Add a new function to `frontend/src/ui.ts`:

```typescript
import { analysis } from './state';

export function renderOverviewBanner(): void {
  const banner = document.getElementById('overview-banner')!;
  if (!analysis) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = '';
  document.getElementById('overview-text')!.textContent = analysis.overview;
  document.getElementById('overview-strategy')!.textContent = analysis.reviewStrategy;

  // Restore collapsed state
  const collapsed = localStorage.getItem('lgtm-overview-collapsed') === 'true';
  banner.classList.toggle('collapsed', collapsed);

  // Toggle handler (remove old listener by replacing element)
  const toggle = document.getElementById('overview-toggle')!;
  const newToggle = toggle.cloneNode(true) as HTMLElement;
  toggle.replaceWith(newToggle);
  newToggle.addEventListener('click', () => {
    const isCollapsed = banner.classList.toggle('collapsed');
    localStorage.setItem('lgtm-overview-collapsed', String(isCollapsed));
  });
}
```

Call `renderOverviewBanner()` inside the existing `switchToItem` function, in the `data.mode === 'diff'` branch, after the meta bar rendering.

- [ ] **Step 4: Verify build passes**

Run: `cd /Users/tom/dev/claude-review/frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/src/style.css frontend/src/ui.ts
git commit -m "add collapsible overview banner for analysis data"
```

---

### Task 5: Frontend — File Header Summary

**Files:**
- Modify: `frontend/src/diff.ts`
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Add file summary to the diff file header**

In `frontend/src/diff.ts`, in the `renderDiff` function, find the line that builds the file header HTML:

```typescript
let html = `<div class="diff-file-header">${escapeHtml(file.path)} <a style="float:right;font-size:11px;font-weight:400;color:var(--accent);cursor:pointer;text-decoration:none" data-action="show-whole-file" data-file-idx="${fileIdx}">Show whole file</a></div>`;
```

Replace with:

```typescript
import { analysis } from './state';

const fileAnalysis = analysis?.files[file.path];
const summaryHtml = fileAnalysis
  ? `<div class="file-header-summary">${escapeHtml(fileAnalysis.summary)}</div>`
  : '';
let html = `<div class="diff-file-header">${escapeHtml(file.path)} <a style="float:right;font-size:11px;font-weight:400;color:var(--accent);cursor:pointer;text-decoration:none" data-action="show-whole-file" data-file-idx="${fileIdx}">Show whole file</a>${summaryHtml}</div>`;
```

- [ ] **Step 2: Add file header summary style**

Add to `frontend/src/style.css`:

```css
.file-header-summary {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
  margin-top: 2px;
}
```

- [ ] **Step 3: Verify build passes**

Run: `cd /Users/tom/dev/claude-review/frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/diff.ts frontend/src/style.css
git commit -m "show per-file analysis summary in sticky diff header"
```

---

### Task 6: Frontend — Sidebar View Toggle and Flat View Enrichment

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/style.css`
- Modify: `frontend/src/ui.ts`

- [ ] **Step 1: Add view toggle HTML**

In `frontend/index.html`, replace the sidebar-search div:

```html
<div class="sidebar">
  <div class="sidebar-controls">
    <div class="view-toggle" id="view-toggle" style="display:none">
      <button class="view-btn active" data-view="flat">Flat</button>
      <button class="view-btn" data-view="grouped">Grouped</button>
      <button class="view-btn" data-view="phased">Phased</button>
    </div>
    <div class="sidebar-search">
      <input type="text" id="file-search" placeholder="Filter files... (f)" autocomplete="off">
    </div>
  </div>
  <div class="file-list" id="file-list"></div>
</div>
```

- [ ] **Step 2: Add view toggle and priority indicator styles**

Add to `frontend/src/style.css`:

```css
/* --- Sidebar controls --- */
.sidebar-controls {
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

/* --- View toggle --- */
.view-toggle {
  display: flex;
  gap: 0;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.view-btn {
  padding: 3px 12px;
  background: var(--bg);
  color: var(--text-muted);
  border: 1px solid var(--border);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.view-btn:first-child { border-radius: 4px 0 0 4px; }
.view-btn:last-child { border-radius: 0 4px 4px 0; }
.view-btn:not(:first-child) { border-left: none; }
.view-btn.active {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.view-btn:hover:not(.active) { background: var(--hover); color: var(--text); }

/* --- Priority indicators --- */
.file-item.priority-critical { border-left: 3px solid #f85149; }
.file-item.priority-important { border-left: 3px solid #d29922; }
.file-item.priority-normal { border-left: 3px solid #58a6ff; }
.file-item.priority-low { border-left: 3px solid #8b949e; }
.file-item.priority-low:not(.active) { opacity: 0.5; }

/* --- File summary in sidebar --- */
.file-item .file-summary {
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  line-height: 1.4;
  margin-top: 1px;
}
```

- [ ] **Step 3: Wire up view toggle**

In `frontend/src/ui.ts`, add a function to render and handle the view toggle:

```typescript
import { analysis, sidebarView, setSidebarView } from './state';
import { saveState } from './persistence';

export function renderViewToggle(): void {
  const toggle = document.getElementById('view-toggle')!;
  if (!analysis) {
    toggle.style.display = 'none';
    return;
  }
  toggle.style.display = '';
  toggle.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.view === sidebarView);
  });
}

export function setupViewToggle(): void {
  document.getElementById('view-toggle')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.view-btn') as HTMLElement;
    if (!btn || btn.dataset.view === sidebarView) return;
    setSidebarView(btn.dataset.view as SidebarView);
    saveState();
    renderViewToggle();
    renderFileList();
  });
}
```

Add `SidebarView` to the imports from `'./state'`.

- [ ] **Step 4: Enrich flat view in renderFileList**

In the existing `renderFileList` function in `ui.ts`, modify the file item rendering to add priority class and summary when analysis exists. Inside the `files.forEach` loop, after building the `div`:

```typescript
// Add priority class
if (analysis?.files[file.path]) {
  div.classList.add(`priority-${analysis.files[file.path].priority}`);
}

// Add summary to filename span (after base)
const fileSummary = analysis?.files[file.path]?.summary;
```

And in the innerHTML template, after the base filename span, add:

```typescript
${fileSummary ? `<span class="file-summary">${escapeHtml(fileSummary)}</span>` : ''}
```

When analysis exists and `sidebarView === 'flat'`, sort files by priority before rendering. At the top of `renderFileList`, after `const el = ...`:

```typescript
import { sortFilesByPriority } from './analysis';

const displayFiles = analysis && sidebarView === 'flat'
  ? sortFilesByPriority(files, analysis)
  : files;
```

Then use `displayFiles` in the forEach loop instead of `files`, but keep using the original `files` array index for `dataset.idx` (map back via `files.indexOf(file)`).

- [ ] **Step 5: Call renderViewToggle and setupViewToggle**

Call `renderViewToggle()` inside `switchToItem` (in the diff branch, after `renderFileList`). Call `setupViewToggle()` in `main.ts` alongside the other setup calls.

- [ ] **Step 6: Verify build passes**

Run: `cd /Users/tom/dev/claude-review/frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add frontend/index.html frontend/src/style.css frontend/src/ui.ts frontend/src/main.ts
git commit -m "add sidebar view toggle and priority indicators in flat view"
```

---

### Task 7: Frontend — Grouped View

**Files:**
- Modify: `frontend/src/ui.ts`
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Add grouped view rendering function**

In `frontend/src/ui.ts`, add a function that replaces the file list content with grouped rendering:

```typescript
import { groupFiles } from './analysis';

function renderGroupedFileList(): void {
  const el = document.getElementById('file-list')!;
  el.innerHTML = '';

  if (!analysis) return;
  const groups = groupFiles(files, analysis);

  for (const group of groups) {
    // Determine if group should start expanded
    const hasHighPriority = group.files.some(f => {
      const p = analysis!.files[f.path]?.priority;
      return p === 'critical' || p === 'important';
    });

    const header = document.createElement('div');
    header.className = 'group-header';
    header.dataset.expanded = String(hasHighPriority);

    const totalAdd = group.files.reduce((s, f) => s + f.additions, 0);
    const totalDel = group.files.reduce((s, f) => s + f.deletions, 0);

    header.innerHTML = `
      <div class="group-header-left">
        <span class="group-chevron">${hasHighPriority ? '▾' : '▸'}</span>
        <span class="group-name">${escapeHtml(group.name)}</span>
        <span class="group-count">${group.files.length} file${group.files.length !== 1 ? 's' : ''}</span>
        ${group.description ? `<span class="group-desc">${escapeHtml(group.description)}</span>` : ''}
      </div>
      <div class="group-stats">
        <span class="add">+${totalAdd}</span>
        <span class="del">-${totalDel}</span>
      </div>
    `;

    const fileContainer = document.createElement('div');
    fileContainer.className = 'group-files';
    fileContainer.style.display = hasHighPriority ? '' : 'none';

    for (const file of group.files) {
      const idx = files.indexOf(file);
      const div = document.createElement('div');
      const isReviewed = reviewedFiles.has(file.path);
      const priority = analysis!.files[file.path]?.priority;
      div.className = 'file-item grouped' + (idx === activeFileIdx ? ' active' : '') + (isReviewed ? ' reviewed' : '') + (priority ? ` priority-${priority}` : '');
      div.dataset.idx = String(idx);

      const base = file.path.split('/').pop() || file.path;
      const commentCount = Object.keys(comments).filter(k => k.startsWith(file.path + '::')).length;
      const claudeCount = claudeComments.filter(c => c.file === file.path).length;

      div.innerHTML = `
        <span class="review-check" title="Mark as reviewed (e)">${isReviewed ? '&#10003;' : '&#9675;'}</span>
        <span class="filename"><span class="base">${escapeHtml(base)}</span></span>
        ${claudeCount > 0 ? `<span class="badge claude-badge" title="Claude comments">${claudeCount}</span>` : ''}
        ${commentCount > 0 ? `<span class="badge comments-badge" title="Your comments">${commentCount}</span>` : ''}
        <span class="file-stats">
          <span class="add">+${file.additions}</span>
          <span class="del">-${file.deletions}</span>
        </span>
      `;
      div.querySelector('.review-check')!.addEventListener('click', (ev) => { ev.stopPropagation(); toggleReviewed(file.path); });
      div.onclick = () => selectFile(idx);
      fileContainer.appendChild(div);
    }

    header.addEventListener('click', () => {
      const expanded = header.dataset.expanded === 'true';
      header.dataset.expanded = String(!expanded);
      header.querySelector('.group-chevron')!.textContent = expanded ? '▸' : '▾';
      fileContainer.style.display = expanded ? 'none' : '';
    });

    el.appendChild(header);
    el.appendChild(fileContainer);
  }
}
```

Note: `toggleReviewed` is already defined in `ui.ts` but is a module-private function. It's already accessible within the same file.

- [ ] **Step 2: Integrate into renderFileList**

At the top of the existing `renderFileList` function, add a delegation check:

```typescript
if (analysis && sidebarView === 'grouped') {
  renderGroupedFileList();
  return;
}
if (analysis && sidebarView === 'phased') {
  renderPhasedFileList(); // implemented in next task
  return;
}
```

- [ ] **Step 3: Add group styles**

Add to `frontend/src/style.css`:

```css
/* --- Group headers --- */
.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
}
.group-header:hover { background: var(--hover); }
.group-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.group-chevron {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
  width: 10px;
}
.group-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}
.group-count {
  font-size: 10px;
  color: var(--text-muted);
}
.group-desc {
  font-size: 10px;
  color: var(--text-muted);
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group-stats {
  font-size: 10px;
  flex-shrink: 0;
}
.group-stats .add { color: var(--add-text); }
.group-stats .del { color: var(--del-text); }
.group-item .filename { padding-left: 8px; }
```

- [ ] **Step 4: Verify build passes**

Run: `cd /Users/tom/dev/claude-review/frontend && npx tsc --noEmit`
Expected: No type errors (phased view will be a stub/forward declaration for now)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ui.ts frontend/src/style.css
git commit -m "add grouped sidebar view with collapsible groups"
```

---

### Task 8: Frontend — Phased View

**Files:**
- Modify: `frontend/src/ui.ts`
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Add phased view rendering function**

In `frontend/src/ui.ts`, add:

```typescript
import { phaseFiles } from './analysis';

const PHASE_CONFIG = {
  review: { label: 'Review carefully', color: '#f85149', icon: '⬤' },
  skim: { label: 'Skim', color: '#d29922', icon: '◐' },
  'rubber-stamp': { label: 'Rubber stamp', color: '#8b949e', icon: '○' },
} as const;

function renderPhasedFileList(): void {
  const el = document.getElementById('file-list')!;
  el.innerHTML = '';

  if (!analysis) return;
  const phases = phaseFiles(files, analysis);

  for (const phase of ['review', 'skim', 'rubber-stamp'] as const) {
    const phaseFiles_ = phases[phase];
    if (phaseFiles_.length === 0) continue;

    const config = PHASE_CONFIG[phase];
    const reviewedCount = phaseFiles_.filter(f => reviewedFiles.has(f.path)).length;
    const pct = Math.round((reviewedCount / phaseFiles_.length) * 100);

    const header = document.createElement('div');
    header.className = 'phase-header';
    header.innerHTML = `
      <div class="phase-header-top">
        <span class="phase-label" style="color: ${config.color}">${config.icon} ${config.label}</span>
        <span class="phase-progress-text">${reviewedCount} / ${phaseFiles_.length} reviewed</span>
      </div>
      <div class="phase-progress-bar">
        <div class="phase-progress-fill" style="width: ${pct}%; background: ${config.color}"></div>
      </div>
    `;
    el.appendChild(header);

    for (const file of phaseFiles_) {
      const idx = files.indexOf(file);
      const div = document.createElement('div');
      const isReviewed = reviewedFiles.has(file.path);
      div.className = 'file-item phased' + (idx === activeFileIdx ? ' active' : '') + (isReviewed ? ' reviewed' : '');
      div.dataset.idx = String(idx);

      const base = file.path.split('/').pop() || file.path;
      const commentCount = Object.keys(comments).filter(k => k.startsWith(file.path + '::')).length;
      const claudeCount = claudeComments.filter(c => c.file === file.path).length;

      div.innerHTML = `
        <span class="review-check" title="Mark as reviewed (e)">${isReviewed ? '&#10003;' : '&#9675;'}</span>
        <span class="filename"><span class="base">${escapeHtml(base)}</span></span>
        ${claudeCount > 0 ? `<span class="badge claude-badge" title="Claude comments">${claudeCount}</span>` : ''}
        ${commentCount > 0 ? `<span class="badge comments-badge" title="Your comments">${commentCount}</span>` : ''}
        <span class="file-stats">
          <span class="add">+${file.additions}</span>
          <span class="del">-${file.deletions}</span>
        </span>
      `;
      div.querySelector('.review-check')!.addEventListener('click', (ev) => { ev.stopPropagation(); toggleReviewed(file.path); });
      div.onclick = () => selectFile(idx);
      el.appendChild(div);
    }
  }
}
```

- [ ] **Step 2: Add phased view styles**

Add to `frontend/src/style.css`:

```css
/* --- Phase headers --- */
.phase-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  user-select: none;
}
.phase-header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.phase-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.phase-progress-text {
  font-size: 10px;
  color: var(--text-muted);
}
.phase-progress-bar {
  height: 3px;
  background: var(--border);
  border-radius: 2px;
  margin-top: 6px;
  overflow: hidden;
}
.phase-progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s;
}
```

- [ ] **Step 3: Verify build passes and all tests pass**

Run: `cd /Users/tom/dev/claude-review/frontend && npx tsc --noEmit && npx vitest run`
Expected: No type errors, all tests pass

- [ ] **Step 4: Commit**

```bash
git add frontend/src/ui.ts frontend/src/style.css
git commit -m "add phased sidebar view with progress bars"
```

---

### Task 9: Frontend — Fetch Analysis on Init

**Files:**
- Modify: `frontend/src/main.ts`

- [ ] **Step 1: Fetch analysis during init**

In `frontend/src/main.ts`, import and call `fetchAnalysis`:

```typescript
import { fetchAnalysis } from './api';
import { setAnalysis } from './state';
import { setupViewToggle } from './ui';
```

In the `init` function, after `await loadItems()` and before `await switchToItem('diff')`, add:

```typescript
const analysisData = await fetchAnalysis();
if (analysisData) setAnalysis(analysisData);
```

Add `setupViewToggle()` alongside the other setup calls (after `setupFileSearch()`).

- [ ] **Step 2: Verify build passes**

Run: `cd /Users/tom/dev/claude-review/frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run all tests**

Run: `cd /Users/tom/dev/claude-review && python -m pytest tests/ -v && cd frontend && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Build frontend**

Run: `cd /Users/tom/dev/claude-review/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add frontend/src/main.ts
git commit -m "fetch analysis on init and wire up view toggle"
```

---

### Task 10: End-to-End Smoke Test

**Files:** None (manual verification)

- [ ] **Step 1: Start the server**

Run: `cd /Users/tom/dev/claude-review && uv run lgtm --repo .`

- [ ] **Step 2: Verify it loads without analysis (graceful degradation)**

Open the browser. Confirm:
- Sidebar looks identical to before (no view toggle visible)
- Diff view, commenting, file navigation all work normally
- No console errors

- [ ] **Step 3: POST test analysis data**

```bash
curl -X POST http://127.0.0.1:<port>/analysis \
  -H 'Content-Type: application/json' \
  -d '{
    "overview": "This branch refactors the server to FastAPI and adds comment UX improvements.",
    "reviewStrategy": "Start with server.py (core API changes), then review the frontend modules.",
    "files": {
      "server.py": {"priority": "critical", "phase": "review", "summary": "FastAPI migration - all routes rewritten from http.server", "category": "core"},
      "git_ops.py": {"priority": "normal", "phase": "skim", "summary": "Git operations unchanged, minor cleanup", "category": "support"},
      "frontend/src/main.ts": {"priority": "important", "phase": "review", "summary": "Entry point - SSE reconnection and init flow", "category": "frontend"},
      "frontend/src/ui.ts": {"priority": "important", "phase": "review", "summary": "Sidebar rendering, keyboard shortcuts, commit picker", "category": "frontend"},
      "frontend/src/diff.ts": {"priority": "important", "phase": "review", "summary": "Diff parsing and rendering with Claude comment anchoring", "category": "frontend"},
      "frontend/src/comments.ts": {"priority": "normal", "phase": "skim", "summary": "Comment CRUD and formatting", "category": "frontend"},
      "frontend/src/style.css": {"priority": "low", "phase": "rubber-stamp", "summary": "Styling additions for new comment UX", "category": "style"}
    },
    "groups": [
      {"name": "Backend", "description": "FastAPI server and git operations", "files": ["server.py", "git_ops.py"]},
      {"name": "Frontend Core", "description": "Main UI modules", "files": ["frontend/src/main.ts", "frontend/src/ui.ts", "frontend/src/diff.ts"]},
      {"name": "Frontend Support", "files": ["frontend/src/comments.ts", "frontend/src/style.css"]}
    ]
  }'
```

- [ ] **Step 4: Refresh and verify enriched UI**

Press `r` to refresh. Confirm:
- View toggle appears (Flat / Grouped / Phased)
- Flat view shows priority-colored left borders and file summaries
- Grouped view shows collapsible groups with correct files
- Phased view shows three tiers with progress bars
- Overview banner appears with overview and strategy text
- Clicking a file still opens the diff normally
- File header shows the per-file summary
- Overview banner collapse/expand works and persists on refresh
- View mode persists on refresh

- [ ] **Step 5: Commit (if any final fixes needed)**

```bash
git commit -m "final adjustments from smoke test"
```
