# Vite + TypeScript Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the monolithic review.html + server.py into a Vite + vanilla TypeScript frontend with a cleaned-up Python backend, preserving all existing behavior.

**Architecture:** Frontend becomes a Vite project under `frontend/` with TypeScript modules split by responsibility (state, diff, document, comments, UI, API). Backend splits git operations into `git_ops.py` and wraps server state in a `Session` class. Python server serves the Vite build output (`frontend/dist/`) in production; in dev, Vite proxies API requests to the Python server.

**Tech Stack:** Vite, TypeScript, highlight.js (npm), marked (npm), Python http.server

---

## File Structure

### Frontend (`frontend/`)

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies: vite, typescript, highlight.js, marked |
| `tsconfig.json` | TypeScript config, strict mode |
| `vite.config.ts` | Dev server proxy to Python backend |
| `index.html` | Minimal HTML shell (header, sidebar, diff container, toast, keyboard hint) |
| `src/main.ts` | Entry point: init, event listeners, wiring modules together |
| `src/state.ts` | All shared mutable state: files, comments, activeFileIdx, activeItemId, sessionItems, claudeComments, reviewedFiles, repoMeta, allCommits, selectedShas, appMode, mdMeta, lineId tracking |
| `src/api.ts` | Typed fetch wrappers for every server endpoint |
| `src/utils.ts` | escapeHtml, detectLang, highlightLine, showToast |
| `src/diff.ts` | parseDiff, renderDiff, expandContext, showWholeFile, computeWordDiff, renderWordDiff, selectFile, applyHash |
| `src/document.ts` | renderMarkdown, renderMarkdownComments, updateMdStats, toggleMdComment, editMdComment, saveMdComment |
| `src/comments.ts` | toggleComment, editComment, saveComment, cancelComment, deleteComment, jumpToComment, formatDiffComments, formatAllComments |
| `src/ui.ts` | renderFileList, renderTabs, switchToItem, loadItems, loadCommits, renderCommitPanel, commit selection, toggleCommitPanel, applyCommitSelection, filterFiles, refreshDiff, submitReview, setupKeyboardShortcuts, setupResizableSidebar, setupFileSearch |
| `src/style.css` | All CSS (extracted verbatim from review.html `<style>` block) |

### Backend (project root)

| File | Responsibility |
|------|---------------|
| `git_ops.py` | All git subprocess calls: `git_run`, `detect_base_branch`, `get_branch_diff`, `get_selected_commits_diff`, `get_branch_commits`, `get_repo_meta`, `get_file_lines` |
| `server.py` | `Session` class holding state (items, comments, round, config), `ReviewHandler` serving API + static files, `main()` for CLI |

---

## Task 1: Scaffold Vite project

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/.gitignore`

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "claude-review-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "highlight.js": "^11.9.0",
    "marked": "^12.0.1"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `frontend/vite.config.ts`**

The dev server proxies all API paths to the Python server. The Python server port is passed via an environment variable (defaults to 9870).

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/data': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
      '/items': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
      '/commits': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
      '/context': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
      '/file': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
      '/submit': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
      '/comments': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9870}`,
      },
    },
  },
});
```

- [ ] **Step 4: Create `frontend/.gitignore`**

```
node_modules
dist
```

- [ ] **Step 5: Install dependencies**

Run: `cd frontend && npm install`

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/tsconfig.json frontend/vite.config.ts frontend/.gitignore frontend/package-lock.json
git commit -m "scaffold Vite project with TypeScript config and dev proxy"
```

---

## Task 2: Extract HTML and CSS

**Files:**
- Create: `frontend/index.html`
- Create: `frontend/src/style.css`

- [ ] **Step 1: Create `frontend/index.html`**

The HTML structure from review.html, stripped of inline `<style>` and `<script>`. References the CSS via main.ts import and loads the TS entry point.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Code Review</title>
</head>
<body>
<header>
  <h1>Code Review</h1>
  <div class="stats" id="stats"></div>
  <div class="header-actions">
    <div class="commit-toggle" id="commit-toggle-wrap" style="display:none">
      <button class="header-btn" id="commit-toggle-btn">Commits</button>
    </div>
    <button class="header-btn" id="refresh-btn">Refresh</button>
    <button id="submit-btn">Submit Review</button>
  </div>
</header>
<div class="tab-bar" id="tab-bar"></div>
<div class="meta-bar" id="meta-bar" style="display:none"></div>
<div class="commit-panel" id="commit-panel"></div>
<div class="description-banner" id="description-banner" style="display:none"></div>
<div class="main">
  <div class="sidebar">
    <div class="sidebar-search">
      <input type="text" id="file-search" placeholder="Filter files... (f)" autocomplete="off">
    </div>
    <div class="file-list" id="file-list"></div>
  </div>
  <div class="resize-handle" id="resize-handle"></div>
  <div class="diff-container" id="diff-container">
    <div class="empty-state">Loading diff...</div>
  </div>
</div>
<div class="toast" id="toast"></div>
<div class="keyboard-hint">
  Click line to comment &middot; <kbd>Cmd+Enter</kbd> save &middot; <kbd>f</kbd> search &middot; <kbd>e</kbd> reviewed &middot; <kbd>c</kbd> commits &middot; <kbd>n</kbd>/<kbd>p</kbd> next/prev comment
</div>
<script type="module" src="/src/main.ts"></script>
</body>
</html>
```

Note: the `onclick` handlers from the original HTML are removed — they'll be attached via addEventListener in the TS modules instead.

- [ ] **Step 2: Create `frontend/src/style.css`**

Copy the entire `<style>` block content from review.html verbatim (lines 11-753 of the original). No changes to CSS values, selectors, or structure. This is a straight extraction.

- [ ] **Step 3: Commit**

```bash
git add frontend/index.html frontend/src/style.css
git commit -m "extract HTML shell and CSS from review.html"
```

---

## Task 3: Create foundational modules — state, api, utils

**Files:**
- Create: `frontend/src/state.ts`
- Create: `frontend/src/api.ts`
- Create: `frontend/src/utils.ts`

- [ ] **Step 1: Create `frontend/src/state.ts`**

All mutable shared state, extracted from the global variables in review.html's `<script>`. Other modules import and mutate these directly.

```ts
export interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk';
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export interface SessionItem {
  id: string;
  type: string;
  title: string;
  path?: string;
}

export interface ClaudeComment {
  file?: string;
  line?: number;
  block?: number;
  comment: string;
  _item: string;
}

export interface RepoMeta {
  branch?: string;
  baseBranch?: string;
  repoPath?: string;
  repoName?: string;
  pr?: { url: string; number: number; title: string };
}

export interface MdMeta {
  content?: string;
  filename?: string;
  filepath?: string;
  markdown?: boolean;
  title?: string;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

// --- Mutable state ---
export let files: DiffFile[] = [];
export const comments: Record<string, string> = {};
export let activeFileIdx = 0;
export let appMode: 'diff' | 'file' = 'diff';
export let mdMeta: MdMeta = {};
export let repoMeta: RepoMeta = {};
export let claudeComments: ClaudeComment[] = [];
export let sessionItems: SessionItem[] = [];
export let activeItemId = 'diff';
export let allCommits: Commit[] = [];
export const selectedShas = new Set<string>();
export const reviewedFiles = new Set<string>();

// Line ID tracking
let lineIdCounter = 0;
const lineKeyToId: Record<string, string> = {};

export function getLineId(lineKey: string): string {
  if (!lineKeyToId[lineKey]) lineKeyToId[lineKey] = 'lc-' + (lineIdCounter++);
  return lineKeyToId[lineKey];
}

export function lineIdToKey(lineId: string): string | null {
  for (const [key, id] of Object.entries(lineKeyToId)) {
    if (id === lineId) return key;
  }
  return null;
}

export function resetLineIds(): void {
  lineIdCounter = 0;
  for (const key of Object.keys(lineKeyToId)) delete lineKeyToId[key];
}

// Setters for reassignable state (since `export let` can't be reassigned from outside)
export function setFiles(f: DiffFile[]) { files = f; }
export function setActiveFileIdx(i: number) { activeFileIdx = i; }
export function setAppMode(m: 'diff' | 'file') { appMode = m; }
export function setMdMeta(m: MdMeta) { mdMeta = m; }
export function setRepoMeta(m: RepoMeta) { repoMeta = m; }
export function setClaudeComments(c: ClaudeComment[]) { claudeComments = c; }
export function setSessionItems(items: SessionItem[]) { sessionItems = items; }
export function setActiveItemId(id: string) { activeItemId = id; }
export function setAllCommits(c: Commit[]) { allCommits = c; }
```

- [ ] **Step 2: Create `frontend/src/api.ts`**

Typed fetch wrappers for all server endpoints.

```ts
import type { SessionItem, Commit, RepoMeta, ClaudeComment } from './state';

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

export async function fetchItems(): Promise<SessionItem[]> {
  const resp = await fetch('/items');
  const data = await resp.json();
  return data.items || [];
}

export async function fetchItemData(itemId: string, commits?: string): Promise<ItemData> {
  let url = `/data?item=${encodeURIComponent(itemId)}`;
  if (commits) url += `&commits=${commits}`;
  const resp = await fetch(url);
  return resp.json();
}

export async function fetchCommits(): Promise<Commit[]> {
  const resp = await fetch('/commits');
  const data = await resp.json();
  return data.commits || [];
}

export async function fetchContext(
  filepath: string, line: number, count: number, direction: string
): Promise<{ num: number; content: string }[]> {
  const resp = await fetch(
    `/context?file=${encodeURIComponent(filepath)}&line=${line}&count=${count}&direction=${direction}`
  );
  const data = await resp.json();
  return data.lines || [];
}

export async function fetchFile(filepath: string): Promise<{ num: number; content: string }[]> {
  const resp = await fetch(`/file?path=${encodeURIComponent(filepath)}`);
  const data = await resp.json();
  return data.lines || [];
}

export async function submitReview(comments: string, raw: Record<string, string>): Promise<{ ok: boolean; round: number }> {
  const resp = await fetch('/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comments, raw }),
  });
  return resp.json();
}
```

- [ ] **Step 3: Create `frontend/src/utils.ts`**

```ts
import hljs from 'highlight.js';

const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  kt: 'kotlin', cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
  swift: 'swift', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', less: 'less', json: 'json', yaml: 'yaml',
  yml: 'yaml', toml: 'ini', md: 'markdown', ex: 'elixir', exs: 'elixir',
  erl: 'erlang', hs: 'haskell', lua: 'lua', r: 'r', R: 'r',
  pl: 'perl', pm: 'perl', scala: 'scala', tf: 'hcl', vim: 'vim',
  dockerfile: 'dockerfile', makefile: 'makefile',
};

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function detectLang(path: string): string | null {
  const basename = path.split('/').pop()!.toLowerCase();
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile' || basename === 'gnumakefile') return 'makefile';
  if (basename === 'gemfile' || basename === 'rakefile' || basename.endsWith('.gemspec')) return 'ruby';
  const ext = basename.split('.').pop()!;
  return EXT_TO_LANG[ext] || null;
}

export function highlightLine(code: string, lang: string): string {
  if (!lang || !hljs.getLanguage(lang)) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

export function showToast(msg: string, duration = 2500): void {
  const t = document.getElementById('toast')!;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/state.ts frontend/src/api.ts frontend/src/utils.ts
git commit -m "add foundational modules: state, api, utils"
```

---

## Task 4: Create diff module

**Files:**
- Create: `frontend/src/diff.ts`

- [ ] **Step 1: Create `frontend/src/diff.ts`**

Contains diff parsing, rendering, word-level diff, context expansion, whole-file view, and file selection. All functions that were in the `<script>` block related to diff rendering.

```ts
import {
  files, activeFileIdx, comments, claudeComments,
  getLineId, lineIdToKey, resetLineIds,
  setFiles, setActiveFileIdx,
  type DiffFile, type DiffLine,
} from './state';
import { fetchContext, fetchFile } from './api';
import { escapeHtml, detectLang, highlightLine, showToast } from './utils';
import { toggleComment, editComment } from './comments';
import { renderFileList } from './ui';

export function parseDiff(raw: string): DiffFile[] {
  const result: DiffFile[] = [];
  const lines = raw.split('\n');
  let current: DiffFile | null = null;
  let oldLine = 0, newLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('diff --git')) {
      current = { path: '', additions: 0, deletions: 0, lines: [] };
      result.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('--- a/') || line.startsWith('--- /dev/null')) continue;
    if (line.startsWith('+++ b/')) { current.path = line.slice(6); continue; }
    if (line.startsWith('+++ /dev/null')) {
      if (i > 0 && lines[i - 1].startsWith('--- a/')) current.path = lines[i - 1].slice(6) + ' (deleted)';
      continue;
    }
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (match) {
        oldLine = parseInt(match[1]);
        newLine = parseInt(match[2]);
        current.lines.push({ type: 'hunk', content: line, oldLine: null, newLine: null });
      }
      continue;
    }
    if (/^(index |Binary |new file|deleted file|old mode|new mode|similarity|rename|copy )/.test(line)) continue;

    if (line.startsWith('+')) {
      current.additions++;
      current.lines.push({ type: 'add', content: line.slice(1), oldLine: null, newLine: newLine++ });
    } else if (line.startsWith('-')) {
      current.deletions++;
      current.lines.push({ type: 'del', content: line.slice(1), oldLine: oldLine++, newLine: null });
    } else if (line.startsWith(' ') || line === '') {
      current.lines.push({ type: 'context', content: line.slice(1) || '', oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return result.filter(f => f.path);
}

function computeWordDiff(oldStr: string, newStr: string) {
  const oldWords = oldStr.match(/\S+|\s+/g) || [];
  const newWords = newStr.match(/\S+|\s+/g) || [];

  const m = oldWords.length, n = newWords.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldWords[i - 1] === newWords[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  let i = m, j = n;
  const oldParts: { text: string; changed: boolean }[] = [];
  const newParts: { text: string; changed: boolean }[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      oldParts.unshift({ text: oldWords[i - 1], changed: false });
      newParts.unshift({ text: newWords[j - 1], changed: false });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      newParts.unshift({ text: newWords[j - 1], changed: true });
      j--;
    } else {
      oldParts.unshift({ text: oldWords[i - 1], changed: true });
      i--;
    }
  }
  return { oldParts, newParts };
}

function renderWordDiff(parts: { text: string; changed: boolean }[], cls: string): string {
  return parts.map(p => p.changed ? `<span class="${cls}">${escapeHtml(p.text)}</span>` : escapeHtml(p.text)).join('');
}

export function renderDiff(fileIdx: number): void {
  const file = files[fileIdx];
  if (!file) return;
  const container = document.getElementById('diff-container')!;
  const lang = detectLang(file.path);

  let html = `<div class="diff-file-header">${escapeHtml(file.path)} <a style="float:right;font-size:11px;font-weight:400;color:var(--accent);cursor:pointer;text-decoration:none" data-action="show-whole-file" data-file-idx="${fileIdx}">Show whole file</a></div>`;
  html += `<table class="diff-table">`;

  // Pre-compute word diffs for adjacent del/add pairs
  const wordDiffs: Record<number, { text: string; changed: boolean }[]> = {};
  for (let i = 0; i < file.lines.length - 1; i++) {
    if (file.lines[i].type === 'del' && file.lines[i + 1].type === 'add') {
      const wd = computeWordDiff(file.lines[i].content, file.lines[i + 1].content);
      wordDiffs[i] = wd.oldParts;
      wordDiffs[i + 1] = wd.newParts;
    }
  }

  file.lines.forEach((line, lineIdx) => {
    const lineKey = `${file.path}::${lineIdx}`;
    const lineId = getLineId(lineKey);

    if (line.type === 'hunk') {
      const hunkMatch = line.content.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
      const hunkNewStart = hunkMatch ? parseInt(hunkMatch[2]) : 0;

      let prevNewLine = 0;
      for (let pi = lineIdx - 1; pi >= 0; pi--) {
        if (file.lines[pi].newLine != null) { prevNewLine = file.lines[pi].newLine!; break; }
      }
      const gap = hunkNewStart - prevNewLine - 1;
      const isSmallGap = prevNewLine > 0 && gap > 0 && gap <= 8;

      if (isSmallGap) {
        html += `<tr class="expand-row" data-auto-expand data-file="${escapeHtml(file.path)}" data-line="${prevNewLine}" data-count="${gap}">
          <td colspan="3" style="color:var(--text-muted)">&#8943; ${gap} line${gap !== 1 ? 's' : ''} hidden</td>
        </tr>`;
      } else if (hunkNewStart > 1) {
        html += `<tr class="expand-row" data-expand-up data-file="${escapeHtml(file.path)}" data-line="${hunkNewStart}">
          <td colspan="3">&#8943; Show more context above</td>
        </tr>`;
      }
      html += `<tr class="diff-hunk">
        <td class="line-num"></td><td class="line-num"></td>
        <td class="line-content">${escapeHtml(line.content)}</td>
      </tr>`;
    } else {
      const cls = line.type === 'add' ? 'diff-add' : line.type === 'del' ? 'diff-del' : 'diff-context';
      const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';

      let codeHtml: string;
      if (wordDiffs[lineIdx]) {
        const wdCls = line.type === 'del' ? 'wdiff-del' : 'wdiff-add';
        codeHtml = `<code>${renderWordDiff(wordDiffs[lineIdx], wdCls)}</code>`;
      } else if (lang) {
        codeHtml = `<code>${highlightLine(line.content, lang)}</code>`;
      } else {
        codeHtml = `<span class="diff-text">${escapeHtml(line.content)}</span>`;
      }

      html += `<tr class="${cls}" id="line-${lineId}">
        <td class="line-num" data-line-id="${lineId}">${line.oldLine ?? ''}</td>
        <td class="line-num" data-line-id="${lineId}">${line.newLine ?? ''}</td>
        <td class="line-content"><span class="diff-prefix">${prefix}</span>${codeHtml}</td>
      </tr>`;
    }

    // Claude's comments on this line
    const lineNum = line.newLine ?? line.oldLine;
    const claudeForLine = claudeComments.filter(c => c.file === file.path && c.line === lineNum);
    for (const cc of claudeForLine) {
      html += `<tr class="claude-comment-row">
        <td colspan="3">
          <div class="comment-box" style="max-width:calc(100vw - 360px)">
            <div class="claude-comment">
              <span class="claude-label">Claude</span>
              ${escapeHtml(cc.comment)}
            </div>
          </div>
        </td>
      </tr>`;
    }

    if (comments[lineKey]) {
      html += `<tr class="comment-row" id="cr-${lineId}">
        <td colspan="3">
          <div class="comment-box">
            <div class="saved-comment" data-edit-comment="${lineId}">
              ${escapeHtml(comments[lineKey])}
              <span class="edit-hint">click to edit</span>
            </div>
          </div>
        </td>
      </tr>`;
    }
  });

  // Expand context at end of file
  const lastLine = file.lines[file.lines.length - 1];
  if (lastLine && lastLine.newLine) {
    html += `<tr class="expand-row" data-expand-down data-file="${escapeHtml(file.path)}" data-line="${lastLine.newLine}">
      <td colspan="3">&#8943; Show more context below</td>
    </tr>`;
  }

  html += `</table>`;
  container.innerHTML = html;

  // Attach event listeners via delegation
  container.addEventListener('click', handleDiffContainerClick);

  // Auto-expand small gaps
  container.querySelectorAll<HTMLElement>('tr[data-auto-expand]').forEach(row => {
    const count = parseInt(row.dataset.count!) || 8;
    const next = row.nextElementSibling;
    if (next && next.classList.contains('diff-hunk')) next.remove();
    expandContext(row.dataset.file!, parseInt(row.dataset.line!), 'down', row, count);
  });

  // Handle hash-based navigation
  const hash = window.location.hash;
  if (hash) applyHash(hash);
}

function handleDiffContainerClick(e: Event): void {
  const target = e.target as HTMLElement;

  // Line number click -> toggle comment
  const lineNumEl = target.closest<HTMLElement>('.line-num[data-line-id]');
  if (lineNumEl) {
    toggleComment(lineNumEl.dataset.lineId!);
    return;
  }

  // Saved comment click -> edit
  const editEl = target.closest<HTMLElement>('[data-edit-comment]');
  if (editEl) {
    editComment(editEl.dataset.editComment!);
    return;
  }

  // Show whole file
  const wholeFileEl = target.closest<HTMLElement>('[data-action="show-whole-file"]');
  if (wholeFileEl) {
    showWholeFile(parseInt(wholeFileEl.dataset.fileIdx!));
    return;
  }

  // Expand up
  const expandUpEl = target.closest<HTMLElement>('tr[data-expand-up]');
  if (expandUpEl) {
    expandContext(expandUpEl.dataset.file!, parseInt(expandUpEl.dataset.line!), 'up', expandUpEl);
    return;
  }

  // Expand down
  const expandDownEl = target.closest<HTMLElement>('tr[data-expand-down]');
  if (expandDownEl) {
    expandContext(expandDownEl.dataset.file!, parseInt(expandDownEl.dataset.line!), 'down', expandDownEl);
    return;
  }
}

export async function expandContext(filepath: string, lineNum: number, direction: string, rowEl: Element, count = 20): Promise<void> {
  try {
    const lines = await fetchContext(filepath, lineNum, count, direction);
    if (lines.length === 0) {
      rowEl.remove();
      return;
    }
    const lang = detectLang(filepath);
    let html = '';
    for (const l of lines) {
      const highlighted = lang ? `<code>${highlightLine(l.content, lang)}</code>` : `<span class="diff-text">${escapeHtml(l.content)}</span>`;
      html += `<tr class="diff-context">
        <td class="line-num">${l.num}</td>
        <td class="line-num">${l.num}</td>
        <td class="line-content"><span class="diff-prefix"> </span>${highlighted}</td>
      </tr>`;
    }
    const temp = document.createElement('tbody');
    temp.innerHTML = html;
    const rows = Array.from(temp.children);
    if (direction === 'up') {
      for (const row of rows) rowEl.before(row);
    } else {
      let after = rowEl;
      for (const row of rows) { after.after(row); after = row; }
    }
    rowEl.remove();
  } catch { /* ignore */ }
}

export async function showWholeFile(fileIdx: number): Promise<void> {
  const file = files[fileIdx];
  if (!file) return;
  try {
    const lines = await fetchFile(file.path);
    if (lines.length === 0) return;

    const lang = detectLang(file.path);
    const container = document.getElementById('diff-container')!;

    const addLines = new Set<number>();
    file.lines.forEach(l => {
      if (l.type === 'add' && l.newLine) addLines.add(l.newLine);
    });

    let html = `<div class="diff-file-header">${escapeHtml(file.path)} <a style="float:right;font-size:11px;font-weight:400;color:var(--accent);cursor:pointer" data-action="back-to-diff" data-file-idx="${fileIdx}">Back to diff</a></div>`;
    html += `<table class="diff-table">`;
    for (const l of lines) {
      const cls = addLines.has(l.num) ? 'diff-add' : '';
      const codeHtml = lang ? `<code>${highlightLine(l.content, lang)}</code>` : `<span class="diff-text">${escapeHtml(l.content)}</span>`;
      html += `<tr class="${cls}">
        <td class="line-num">${l.num}</td>
        <td class="line-num">${l.num}</td>
        <td class="line-content"><span class="diff-prefix"> </span>${codeHtml}</td>
      </tr>`;
    }
    html += `</table>`;
    container.innerHTML = html;

    // Back-to-diff click handler
    container.querySelector('[data-action="back-to-diff"]')?.addEventListener('click', () => renderDiff(fileIdx));
  } catch (e: any) {
    showToast('Failed to load file: ' + e.message);
  }
}

export function selectFile(idx: number): void {
  setActiveFileIdx(idx);
  document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.file-item[data-idx="${idx}"]`)?.classList.add('active');
  if (files[idx]) window.location.hash = 'file=' + encodeURIComponent(files[idx].path);
  renderDiff(idx);
}

export function applyHash(hash: string): void {
  const match = hash.match(/#file=(.+)/);
  if (!match) return;
  const path = decodeURIComponent(match[1]);
  const idx = files.findIndex(f => f.path === path);
  if (idx >= 0 && idx !== activeFileIdx) selectFile(idx);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/diff.ts
git commit -m "add diff module: parsing, rendering, word diff, context expansion"
```

---

## Task 5: Create document module

**Files:**
- Create: `frontend/src/document.ts`

- [ ] **Step 1: Create `frontend/src/document.ts`**

Markdown rendering and per-block commenting. Uses marked.js for rendering and highlight.js for code blocks.

```ts
import { Marked } from 'marked';
import hljs from 'highlight.js';
import {
  comments, claudeComments, activeItemId,
  mdMeta, setMdMeta, type MdMeta,
} from './state';
import { escapeHtml } from './utils';

const marked = new Marked({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const highlighted = lang && hljs.getLanguage(lang)
        ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
        : hljs.highlightAuto(text).value;
      return `<pre><code class="hljs">${highlighted}</code></pre>`;
    },
  },
});

function mdKey(blockIdx: number): string {
  return activeItemId === 'diff' ? `md::${blockIdx}` : `doc:${activeItemId}:${blockIdx}`;
}

function mdBlockId(blockIdx: number): string {
  return `md-block-${activeItemId}-${blockIdx}`;
}

function mdCommentId(blockIdx: number): string {
  return `md-comment-${activeItemId}-${blockIdx}`;
}

export function renderMarkdown(data: MdMeta & { content: string; claudeComments?: any[] }): void {
  setMdMeta(data);
  const container = document.getElementById('diff-container')!;

  const rawHtml = marked.parse(data.content) as string;
  const temp = document.createElement('div');
  temp.innerHTML = rawHtml;

  let html = '';
  let blockIdx = 0;
  for (const child of Array.from(temp.children)) {
    const key = mdKey(blockIdx);
    const hasComment = !!comments[key];

    // Claude comments on this block
    const claudeForBlock = claudeComments.filter(c => c.block === blockIdx);
    let claudeHtml = '';
    for (const cc of claudeForBlock) {
      claudeHtml += `<div class="md-comment" style="margin:4px 0">
        <div class="comment-box" style="max-width:100%">
          <div class="claude-comment">
            <span class="claude-label">Claude</span>
            ${escapeHtml(cc.comment)}
          </div>
        </div>
      </div>`;
    }

    html += `<div class="md-block ${hasComment ? 'has-comment' : ''}" id="${mdBlockId(blockIdx)}" data-block="${blockIdx}">${child.outerHTML}</div>`;
    html += claudeHtml;
    if (hasComment) {
      html += `<div class="md-comment" id="${mdCommentId(blockIdx)}">
        <div class="comment-box">
          <div class="saved-comment" data-edit-md-comment="${blockIdx}">
            ${escapeHtml(comments[key])}
            <span class="edit-hint">click to edit</span>
          </div>
        </div>
      </div>`;
    }
    blockIdx++;
  }

  container.innerHTML = `<div class="md-content">${html}</div>`;

  // Attach click handlers
  container.querySelectorAll<HTMLElement>('.md-block').forEach(el => {
    el.addEventListener('click', () => toggleMdComment(parseInt(el.dataset.block!)));
  });
  container.querySelectorAll<HTMLElement>('[data-edit-md-comment]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      editMdComment(parseInt(el.dataset.editMdComment!));
    });
  });

  updateMdStats();
}

export function renderMarkdownComments(): void {
  document.querySelectorAll<HTMLElement>('.md-block').forEach(el => {
    const idx = parseInt(el.dataset.block!);
    const key = mdKey(idx);
    el.classList.toggle('has-comment', !!comments[key]);
    const existing = document.getElementById(mdCommentId(idx));
    if (existing) existing.remove();
    if (comments[key]) {
      const div = document.createElement('div');
      div.className = 'md-comment';
      div.id = mdCommentId(idx);
      div.innerHTML = `
        <div class="comment-box">
          <div class="saved-comment" data-edit-md-comment="${idx}">
            ${escapeHtml(comments[key])}
            <span class="edit-hint">click to edit</span>
          </div>
        </div>
      `;
      div.querySelector<HTMLElement>('[data-edit-md-comment]')!.addEventListener('click', (e) => {
        e.stopPropagation();
        editMdComment(idx);
      });
      el.after(div);
    }
  });
  updateMdStats();
}

export function updateMdStats(): void {
  const count = Object.keys(comments).length;
  document.getElementById('stats')!.innerHTML =
    `${mdMeta.filename || 'Document'}` +
    (count > 0 ? ` &middot; ${count} comment${count !== 1 ? 's' : ''}` : '');
}

export function toggleMdComment(blockIdx: number): void {
  const key = mdKey(blockIdx);
  if (comments[key]) { editMdComment(blockIdx); return; }

  const existing = document.getElementById(mdCommentId(blockIdx));
  if (existing) { existing.querySelector('textarea')?.focus(); return; }

  const block = document.getElementById(mdBlockId(blockIdx));
  if (!block) return;

  const div = document.createElement('div');
  div.className = 'md-comment';
  div.id = mdCommentId(blockIdx);
  div.innerHTML = `
    <div class="comment-box">
      <textarea placeholder="Leave a comment..." autofocus onclick="event.stopPropagation()"></textarea>
      <div class="comment-actions">
        <button class="cancel-btn" data-action="cancel">Cancel</button>
        <button class="save-btn" data-action="save">Save</button>
      </div>
    </div>
  `;

  const textarea = div.querySelector('textarea')!;
  textarea.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { div.remove(); e.preventDefault(); }
    else if (e.key === 'Enter' && e.metaKey) { saveMdComment(blockIdx); e.preventDefault(); }
  });
  textarea.addEventListener('click', (e) => e.stopPropagation());
  div.querySelector('[data-action="cancel"]')!.addEventListener('click', (e) => { e.stopPropagation(); div.remove(); });
  div.querySelector('[data-action="save"]')!.addEventListener('click', (e) => { e.stopPropagation(); saveMdComment(blockIdx); });

  block.after(div);
  textarea.focus();
}

export function editMdComment(blockIdx: number): void {
  const key = mdKey(blockIdx);
  const div = document.getElementById(mdCommentId(blockIdx));
  if (!div) return;

  div.innerHTML = `
    <div class="comment-box">
      <textarea onclick="event.stopPropagation()">${escapeHtml(comments[key])}</textarea>
      <div class="comment-actions">
        <button class="cancel-btn" data-action="cancel-edit">Cancel</button>
        <button class="cancel-btn" data-action="delete" style="color: var(--del-text)">Delete</button>
        <button class="save-btn" data-action="save">Save</button>
      </div>
    </div>
  `;

  const textarea = div.querySelector('textarea')!;
  textarea.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { renderMarkdownComments(); e.preventDefault(); }
    else if (e.key === 'Enter' && e.metaKey) { saveMdComment(blockIdx); e.preventDefault(); }
  });
  textarea.addEventListener('click', (e) => e.stopPropagation());
  div.querySelector('[data-action="cancel-edit"]')!.addEventListener('click', (e) => { e.stopPropagation(); renderMarkdownComments(); });
  div.querySelector('[data-action="delete"]')!.addEventListener('click', (e) => { e.stopPropagation(); delete comments[key]; renderMarkdownComments(); });
  div.querySelector('[data-action="save"]')!.addEventListener('click', (e) => { e.stopPropagation(); saveMdComment(blockIdx); });

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function saveMdComment(blockIdx: number): void {
  const key = mdKey(blockIdx);
  const div = document.getElementById(mdCommentId(blockIdx));
  if (!div) return;
  const text = div.querySelector('textarea')?.value?.trim();
  if (!text) delete comments[key];
  else comments[key] = text;
  renderMarkdownComments();
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/document.ts
git commit -m "add document module: markdown rendering with block commenting"
```

---

## Task 6: Create comments module

**Files:**
- Create: `frontend/src/comments.ts`

- [ ] **Step 1: Create `frontend/src/comments.ts`**

Diff-line comment CRUD (create, edit, save, cancel, delete), comment navigation, and formatting functions for submit.

```ts
import {
  comments, files, activeFileIdx, claudeComments,
  sessionItems, activeItemId, mdMeta,
  lineIdToKey,
} from './state';
import { escapeHtml } from './utils';
import { renderDiff } from './diff';
import { renderFileList } from './ui';

export function toggleComment(lineId: string): void {
  const lineKey = lineIdToKey(lineId);
  if (!lineKey) return;
  if (comments[lineKey]) { editComment(lineId); return; }
  const existing = document.getElementById('cr-' + lineId);
  if (existing) { existing.querySelector('textarea')?.focus(); return; }

  const lineRow = document.getElementById('line-' + lineId);
  if (!lineRow) return;

  const commentRow = document.createElement('tr');
  commentRow.className = 'comment-row';
  commentRow.id = 'cr-' + lineId;
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
    if (e.key === 'Escape') { cancelComment(lineId); e.preventDefault(); }
    else if (e.key === 'Enter' && e.metaKey) { saveComment(lineId); e.preventDefault(); }
  });
  commentRow.querySelector('[data-action="cancel"]')!.addEventListener('click', () => cancelComment(lineId));
  commentRow.querySelector('[data-action="save"]')!.addEventListener('click', () => saveComment(lineId));

  lineRow.after(commentRow);
  textarea.focus();
}

export function editComment(lineId: string): void {
  const row = document.getElementById('cr-' + lineId);
  if (!row) return;
  const lineKey = lineIdToKey(lineId);
  if (!lineKey) return;

  const currentText = comments[lineKey];
  const td = row.querySelector('td')!;
  td.innerHTML = `
    <div class="comment-box">
      <textarea>${escapeHtml(currentText)}</textarea>
      <div class="comment-actions">
        <button class="cancel-btn" data-action="cancel-edit">Cancel</button>
        <button class="cancel-btn" data-action="delete" style="color: var(--del-text)">Delete</button>
        <button class="save-btn" data-action="save">Save</button>
      </div>
    </div>
  `;

  const textarea = td.querySelector('textarea')!;
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { renderDiff(activeFileIdx); e.preventDefault(); }
    else if (e.key === 'Enter' && e.metaKey) { saveComment(lineId); e.preventDefault(); }
  });
  td.querySelector('[data-action="cancel-edit"]')!.addEventListener('click', () => renderDiff(activeFileIdx));
  td.querySelector('[data-action="delete"]')!.addEventListener('click', () => deleteComment(lineId));
  td.querySelector('[data-action="save"]')!.addEventListener('click', () => saveComment(lineId));

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function saveComment(lineId: string): void {
  const row = document.getElementById('cr-' + lineId);
  if (!row) return;
  const lineKey = lineIdToKey(lineId);
  if (!lineKey) return;
  const text = row.querySelector('textarea')?.value?.trim();
  if (!text) { deleteComment(lineId); return; }
  comments[lineKey] = text;
  renderDiff(activeFileIdx);
  renderFileList();
}

function cancelComment(lineId: string): void {
  const lineKey = lineIdToKey(lineId);
  if (lineKey && !comments[lineKey]) document.getElementById('cr-' + lineId)?.remove();
}

function deleteComment(lineId: string): void {
  const lineKey = lineIdToKey(lineId);
  if (lineKey) delete comments[lineKey];
  renderDiff(activeFileIdx);
  renderFileList();
}

export function jumpToComment(direction: 'next' | 'prev'): void {
  const container = document.getElementById('diff-container')!;
  const rows = Array.from(container.querySelectorAll('tr.comment-row, tr.claude-comment-row'));
  if (rows.length === 0) return;

  const containerRect = container.getBoundingClientRect();

  if (direction === 'next') {
    const next = rows.find(r => r.getBoundingClientRect().top > containerRect.top + 10);
    if (next) next.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else rows[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else {
    const prev = rows.reverse().find(r => r.getBoundingClientRect().top < containerRect.top - 10);
    if (prev) prev.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else rows[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function formatDiffComments(): string {
  const byFile: Record<string, { lineNum: number | string; lineType: string; lineContent: string; comment: string }[]> = {};
  for (const [key, text] of Object.entries(comments)) {
    if (key.startsWith('doc:') || key.startsWith('md::')) continue;
    const sepIdx = key.lastIndexOf('::');
    const filePath = key.substring(0, sepIdx);
    const lineIdxStr = key.substring(sepIdx + 2);
    if (!byFile[filePath]) byFile[filePath] = [];
    const lineIdx = parseInt(lineIdxStr);
    const file = files.find(f => f.path === filePath);
    const line = file?.lines[lineIdx];
    byFile[filePath].push({
      lineNum: line?.newLine ?? line?.oldLine ?? '?',
      lineType: line?.type ?? 'context',
      lineContent: line?.content ?? '',
      comment: text,
    });
  }
  let output = '';
  for (const [filePath, fileComments] of Object.entries(byFile)) {
    output += `## ${filePath}\n\n`;
    for (const c of fileComments.sort((a, b) => Number(a.lineNum) - Number(b.lineNum))) {
      const prefix = c.lineType === 'add' ? '+' : c.lineType === 'del' ? '-' : ' ';
      output += `Line ${c.lineNum}: \`${prefix}${c.lineContent.trim()}\`\n`;
      output += `> ${c.comment}\n\n`;
    }
  }
  return output;
}

export function formatAllComments(): string {
  let output = '';
  const diffOutput = formatDiffComments();
  if (diffOutput) output += diffOutput;

  for (const item of sessionItems) {
    if (item.id === 'diff') continue;
    const docComments = Object.entries(comments).filter(([k]) => k.startsWith(`doc:${item.id}:`));
    if (docComments.length === 0) continue;
    output += `## ${item.title}\n\n`;
    const sorted = docComments.sort((a, b) => {
      const ai = parseInt(a[0].split(':').pop()!);
      const bi = parseInt(b[0].split(':').pop()!);
      return ai - bi;
    });
    for (const [key, text] of sorted) {
      const blockIdx = parseInt(key.split(':').pop()!);
      const blockEl = document.getElementById(`md-block-${item.id}-${blockIdx}`);
      const preview = blockEl?.textContent?.trim()?.slice(0, 80) || `Block ${blockIdx}`;
      output += `**${preview}${preview.length >= 80 ? '...' : ''}**\n`;
      output += `> ${text}\n\n`;
    }
  }
  return output || 'No comments (LGTM).';
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/comments.ts
git commit -m "add comments module: CRUD, navigation, formatting"
```

---

## Task 7: Create UI module

**Files:**
- Create: `frontend/src/ui.ts`

- [ ] **Step 1: Create `frontend/src/ui.ts`**

All UI chrome: file list sidebar, tab bar, commit picker, file search, keyboard shortcuts, resizable sidebar, refresh, and submit. This is the largest module — it orchestrates the others.

```ts
import {
  files, activeFileIdx, comments, claudeComments, reviewedFiles,
  sessionItems, activeItemId, repoMeta, allCommits, selectedShas, appMode,
  setFiles, setActiveFileIdx, setRepoMeta, setClaudeComments,
  setSessionItems, setActiveItemId, setAllCommits, setAppMode,
  resetLineIds,
} from './state';
import { fetchItems, fetchItemData, fetchCommits, submitReview as apiSubmitReview } from './api';
import { escapeHtml, showToast } from './utils';
import { parseDiff, renderDiff, selectFile } from './diff';
import { renderMarkdown, renderMarkdownComments } from './document';
import { jumpToComment, formatAllComments } from './comments';

// --- File list sidebar ---

export function renderFileList(): void {
  const el = document.getElementById('file-list')!;
  el.innerHTML = '';
  let totalAdd = 0, totalDel = 0;

  files.forEach((file, idx) => {
    totalAdd += file.additions;
    totalDel += file.deletions;

    const div = document.createElement('div');
    const isReviewed = reviewedFiles.has(file.path);
    div.className = 'file-item' + (idx === activeFileIdx ? ' active' : '') + (isReviewed ? ' reviewed' : '');
    div.dataset.idx = String(idx);

    const commentCount = Object.keys(comments).filter(k => k.startsWith(file.path + '::')).length;
    const claudeCount = claudeComments.filter(c => c.file === file.path).length;

    const lastSlash = file.path.lastIndexOf('/');
    const dir = lastSlash >= 0 ? file.path.slice(0, lastSlash + 1) : '';
    const base = lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path;

    div.innerHTML = `
      <span class="review-check" title="Mark as reviewed (e)">${isReviewed ? '&#10003;' : '&#9675;'}</span>
      <span class="filename" title="${escapeHtml(file.path)}">
        ${dir ? `<span class="dir">${escapeHtml(dir)}</span>` : ''}
        <span class="base">${escapeHtml(base)}</span>
      </span>
      ${claudeCount > 0 ? `<span class="badge claude-badge" title="Claude comments">${claudeCount}</span>` : ''}
      ${commentCount > 0 ? `<span class="badge comments-badge" title="Your comments">${commentCount}</span>` : ''}
      <span class="file-stats">
        <span class="add">+${file.additions}</span>
        <span class="del">-${file.deletions}</span>
      </span>
    `;
    div.querySelector('.review-check')!.addEventListener('click', (ev) => toggleReviewed(file.path, ev));
    div.onclick = () => selectFile(idx);
    el.appendChild(div);
  });

  document.getElementById('stats')!.innerHTML = `
    ${files.length} file${files.length !== 1 ? 's' : ''} &middot;
    <span class="add">+${totalAdd}</span> <span class="del">-${totalDel}</span>
    ${Object.keys(comments).length > 0 ? ` &middot; ${Object.keys(comments).length} comment${Object.keys(comments).length !== 1 ? 's' : ''}` : ''}
  `;

  const q = (document.getElementById('file-search') as HTMLInputElement).value;
  if (q) filterFiles(q);
}

function toggleReviewed(path: string, e?: Event): void {
  if (e) e.stopPropagation();
  if (reviewedFiles.has(path)) reviewedFiles.delete(path);
  else reviewedFiles.add(path);
  renderFileList();
}

export function filterFiles(query: string): void {
  const q = query.toLowerCase();
  document.querySelectorAll<HTMLElement>('.file-item').forEach(el => {
    const path = el.querySelector('.filename')!.textContent!.toLowerCase();
    el.classList.toggle('hidden', q !== '' && !path.includes(q));
  });
}

// --- Tabs ---

export function renderTabs(): void {
  const bar = document.getElementById('tab-bar')!;
  bar.innerHTML = '';
  for (const item of sessionItems) {
    const tab = document.createElement('div');
    tab.className = 'tab-item' + (item.id === activeItemId ? ' active' : '');
    tab.dataset.id = item.id;

    let badges = '';
    const effUserCount = item.id === 'diff'
      ? Object.keys(comments).filter(k => !k.startsWith('doc:')).length
      : Object.keys(comments).filter(k => k.startsWith(`doc:${item.id}:`)).length;
    const claudeCount = claudeComments.filter(c => c._item === item.id).length;

    if (claudeCount > 0) badges += `<span class="tab-badge claude">${claudeCount}</span>`;
    if (effUserCount > 0) badges += `<span class="tab-badge user">${effUserCount}</span>`;

    tab.innerHTML = `${escapeHtml(item.title)}${badges}`;
    tab.onclick = () => switchToItem(item.id);
    bar.appendChild(tab);
  }
}

// --- Item switching ---

export async function loadItems(): Promise<void> {
  try {
    const items = await fetchItems();
    setSessionItems(items);
    renderTabs();
  } catch { /* ignore */ }
}

export async function switchToItem(itemId: string): Promise<void> {
  setActiveItemId(itemId);
  renderTabs();

  const data = await fetchItemData(itemId);

  if (data.mode === 'diff') {
    document.querySelector<HTMLElement>('.sidebar')!.style.display = '';
    document.getElementById('resize-handle')!.style.display = '';
    document.querySelector('.keyboard-hint')!.innerHTML = 'Click line to comment &middot; <kbd>Cmd+Enter</kbd> save &middot; <kbd>f</kbd> search &middot; <kbd>e</kbd> reviewed &middot; <kbd>c</kbd> commits &middot; <kbd>n</kbd>/<kbd>p</kbd> next/prev comment';

    setRepoMeta(data.meta || {});
    setClaudeComments((data.claudeComments || []).map(c => ({ ...c, _item: 'diff' })));
    setAppMode('diff');

    if (data.description) {
      const banner = document.getElementById('description-banner')!;
      banner.textContent = data.description;
      banner.style.display = '';
    } else {
      document.getElementById('description-banner')!.style.display = 'none';
    }

    // Meta bar
    if (repoMeta.branch) {
      const bar = document.getElementById('meta-bar')!;
      let metaHtml = `<span class="branch">${escapeHtml(repoMeta.branch)}</span>`;
      metaHtml += `<span>vs ${escapeHtml(repoMeta.baseBranch || 'master')}</span>`;
      if (repoMeta.repoPath) metaHtml += `<span>${escapeHtml(repoMeta.repoPath)}</span>`;
      if (repoMeta.pr) {
        metaHtml += `<a class="pr-link" href="${escapeHtml(repoMeta.pr.url)}" target="_blank">PR #${repoMeta.pr.number}: ${escapeHtml(repoMeta.pr.title)}</a>`;
      }
      bar.innerHTML = metaHtml;
      bar.style.display = '';
    }

    setFiles(parseDiff(data.diff));
    renderFileList();
    if (files.length > 0) selectFile(0);
    else document.getElementById('diff-container')!.innerHTML = '<div class="empty-state">No changes to review</div>';
    loadCommits();

  } else if (data.mode === 'file') {
    document.querySelector<HTMLElement>('.sidebar')!.style.display = 'none';
    document.getElementById('resize-handle')!.style.display = 'none';
    document.getElementById('meta-bar')!.style.display = 'none';
    document.getElementById('description-banner')!.style.display = 'none';
    document.querySelector('.keyboard-hint')!.innerHTML = 'Click any block to comment &middot; <kbd>Cmd+Enter</kbd> save &middot; <kbd>Esc</kbd> cancel';

    setClaudeComments((data.claudeComments || []).map(c => ({ ...c, _item: activeItemId })));
    setAppMode('file');
    renderMarkdown(data);
  }
}

// --- Commit picker ---

export async function loadCommits(): Promise<void> {
  try {
    const commits = await fetchCommits();
    setAllCommits(commits);
    if (commits.length === 0) return;

    document.getElementById('commit-toggle-wrap')!.style.display = '';
    commits.forEach(c => selectedShas.add(c.sha));
    updateCommitToggle();
    renderCommitPanel();
  } catch { /* ignore */ }
}

function updateCommitToggle(): void {
  const btn = document.getElementById('commit-toggle-btn')!;
  const total = allCommits.length;
  const selected = selectedShas.size;
  btn.innerHTML = selected === total ? `Commits (${total})` : `Commits (${selected}/${total})`;
}

export function toggleCommitPanel(): void {
  document.getElementById('commit-panel')!.classList.toggle('open');
}

function renderCommitPanel(): void {
  const panel = document.getElementById('commit-panel')!;
  let html = `<div class="commit-actions">
    <a data-action="select-all-commits">Select all</a>
    <a data-action="select-none-commits">Select none</a>
    <a data-action="apply-commits">Apply</a>
  </div>`;
  html += '<div class="commit-list">';
  for (const c of allCommits) {
    const checked = selectedShas.has(c.sha) ? 'checked' : '';
    html += `<label class="commit-item">
      <input type="checkbox" ${checked} data-sha="${c.sha}">
      <span class="commit-sha">${c.sha.slice(0, 7)}</span>
      <span class="commit-msg" title="${escapeHtml(c.message)}">${escapeHtml(c.message)}</span>
      <span class="commit-date">${escapeHtml(c.date)}</span>
    </label>`;
  }
  html += '</div>';
  panel.innerHTML = html;

  // Event listeners
  panel.querySelectorAll<HTMLInputElement>('input[data-sha]').forEach(el => {
    el.addEventListener('change', () => {
      if (el.checked) selectedShas.add(el.dataset.sha!);
      else selectedShas.delete(el.dataset.sha!);
      updateCommitToggle();
    });
  });
  panel.querySelector('[data-action="select-all-commits"]')!.addEventListener('click', () => {
    allCommits.forEach(c => selectedShas.add(c.sha));
    renderCommitPanel();
    updateCommitToggle();
  });
  panel.querySelector('[data-action="select-none-commits"]')!.addEventListener('click', () => {
    selectedShas.clear();
    renderCommitPanel();
    updateCommitToggle();
  });
  panel.querySelector('[data-action="apply-commits"]')!.addEventListener('click', applyCommitSelection);
}

async function applyCommitSelection(): Promise<void> {
  document.getElementById('commit-panel')!.classList.remove('open');

  const commits = selectedShas.size > 0 && selectedShas.size < allCommits.length
    ? Array.from(selectedShas).join(',')
    : undefined;

  try {
    const data = await fetchItemData('diff', commits);
    if (data.mode !== 'diff') return;
    setFiles(parseDiff(data.diff));
    resetLineIds();
    if (activeFileIdx >= files.length) setActiveFileIdx(0);
    renderFileList();
    if (files.length > 0) renderDiff(activeFileIdx);
    else document.getElementById('diff-container')!.innerHTML = '<div class="empty-state">No changes for selected commits</div>';
    showToast(`Showing ${selectedShas.size} commit${selectedShas.size !== 1 ? 's' : ''}`);
  } catch (e: any) {
    showToast('Failed to apply: ' + e.message);
  }
}

// --- Actions ---

export async function refreshDiff(): Promise<void> {
  try {
    await loadItems();
    await switchToItem(activeItemId);
    showToast('Refreshed');
  } catch (e: any) {
    showToast('Failed to refresh: ' + e.message);
  }
}

export async function handleSubmitReview(): Promise<void> {
  const btn = document.getElementById('submit-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const formatted = formatAllComments();
    const result = await apiSubmitReview(formatted, { ...comments });
    showToast(`Review round ${result.round} submitted!`, 3000);
    for (const key of Object.keys(comments)) delete comments[key];
    if (appMode === 'file') {
      renderMarkdownComments();
    } else {
      renderFileList();
      renderDiff(activeFileIdx);
    }
  } catch (e: any) {
    showToast('Failed to submit: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Review';
  }
}

// --- Keyboard shortcuts ---

export function setupKeyboardShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      const next = activeFileIdx + 1;
      if (next < files.length) selectFile(next);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      const prev = activeFileIdx - 1;
      if (prev >= 0) selectFile(prev);
    } else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
      refreshDiff();
    } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      document.getElementById('file-search')!.focus();
    } else if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
      if (allCommits.length > 0) toggleCommitPanel();
    } else if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
      if (files[activeFileIdx]) toggleReviewed(files[activeFileIdx].path);
    } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
      jumpToComment('next');
    } else if (e.key === 'p' && !e.metaKey && !e.ctrlKey) {
      jumpToComment('prev');
    }
  });
}

// --- Resizable sidebar ---

export function setupResizableSidebar(): void {
  const handle = document.getElementById('resize-handle')!;
  const sidebar = document.querySelector('.sidebar') as HTMLElement;
  let dragging = false;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const newWidth = Math.min(Math.max(e.clientX, 150), 600);
    sidebar.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// --- File search ---

export function setupFileSearch(): void {
  const input = document.getElementById('file-search') as HTMLInputElement;
  input.addEventListener('input', () => filterFiles(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      filterFiles('');
      input.blur();
    } else if (e.key === 'Enter') {
      const first = document.querySelector<HTMLElement>('.file-item:not(.hidden)');
      if (first) selectFile(parseInt(first.dataset.idx!));
      input.blur();
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/ui.ts
git commit -m "add UI module: sidebar, tabs, commits, shortcuts, resize"
```

---

## Task 8: Create main entry point and verify frontend builds

**Files:**
- Create: `frontend/src/main.ts`

- [ ] **Step 1: Create `frontend/src/main.ts`**

Entry point that imports CSS, wires up event listeners, and runs init.

```ts
import 'highlight.js/styles/github-dark.css';
import './style.css';

import { repoMeta } from './state';
import { fetchItemData } from './api';
import { applyHash } from './diff';
import { escapeHtml } from './utils';
import {
  loadItems, switchToItem, refreshDiff, handleSubmitReview,
  toggleCommitPanel, setupKeyboardShortcuts, setupResizableSidebar, setupFileSearch,
} from './ui';

async function init(): Promise<void> {
  try {
    await loadItems();

    // Set page title from first load
    const data = await fetchItemData('diff');
    if (data.mode === 'diff') {
      const branch = data.meta?.branch || 'Review';
      document.title = `Review: ${branch}`;
      document.querySelector('h1')!.textContent = `Review: ${branch}`;
    }

    // Load the default item (diff)
    await switchToItem('diff');
  } catch (e: any) {
    document.getElementById('diff-container')!.innerHTML = `<div class="empty-state">Error: ${escapeHtml(e.message)}</div>`;
  }
}

// Wire up header buttons
document.getElementById('commit-toggle-btn')!.addEventListener('click', toggleCommitPanel);
document.getElementById('refresh-btn')!.addEventListener('click', refreshDiff);
document.getElementById('submit-btn')!.addEventListener('click', handleSubmitReview);

// Hash-based navigation
window.addEventListener('hashchange', () => applyHash(window.location.hash));

// Setup
setupKeyboardShortcuts();
setupResizableSidebar();
setupFileSearch();

// Go
init();
```

- [ ] **Step 2: Verify the frontend builds**

Run: `cd frontend && npx tsc --noEmit`

Fix any type errors. Then:

Run: `cd frontend && npm run build`

Expected: Vite produces `frontend/dist/` with bundled JS and CSS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/main.ts
git commit -m "add main entry point, wire up init and event listeners"
```

---

## Task 9: Extract git_ops.py from server.py

**Files:**
- Create: `git_ops.py`

- [ ] **Step 1: Create `git_ops.py`**

Extract all git-related functions. They take `repo_path` as a parameter instead of reading the global.

```python
import json
import subprocess
from pathlib import Path


def git_run(repo_path, *args):
    result = subprocess.run(
        ['git'] + list(args),
        capture_output=True, text=True, cwd=repo_path
    )
    return result.stdout.strip()


def detect_base_branch(repo_path):
    for candidate in ['master', 'main']:
        result = subprocess.run(
            ['git', 'rev-parse', '--verify', candidate],
            capture_output=True, text=True, cwd=repo_path
        )
        if result.returncode == 0:
            return candidate
    return 'master'


def get_branch_diff(repo_path, base_branch):
    files_output = git_run(
        repo_path,
        'log', '--first-parent', '--no-merges',
        '--diff-filter=ACDMR', '--name-only', '--format=',
        f'{base_branch}..HEAD'
    )
    if not files_output.strip():
        return ''
    branch_files = sorted(set(f for f in files_output.split('\n') if f.strip()))
    if not branch_files:
        return ''
    merge_base = git_run(repo_path, 'merge-base', base_branch, 'HEAD')
    return git_run(repo_path, 'diff', merge_base, 'HEAD', '--', *branch_files)


def get_selected_commits_diff(repo_path, shas):
    diffs = []
    for sha in shas:
        diffs.append(git_run(repo_path, 'diff-tree', '-p', '--no-commit-id', sha))
    return '\n'.join(diffs)


def get_branch_commits(repo_path, base_branch):
    output = git_run(
        repo_path,
        'log', '--first-parent', '--no-merges',
        '--format=%H|%s|%an|%ar',
        f'{base_branch}..HEAD'
    )
    commits = []
    for line in output.split('\n'):
        if '|' not in line:
            continue
        parts = line.split('|', 3)
        if len(parts) < 4:
            continue
        commits.append({
            'sha': parts[0], 'message': parts[1],
            'author': parts[2], 'date': parts[3],
        })
    return commits


def get_repo_meta(repo_path, base_branch):
    branch = git_run(repo_path, 'rev-parse', '--abbrev-ref', 'HEAD')
    meta = {
        'branch': branch,
        'baseBranch': base_branch,
        'repoPath': repo_path,
        'repoName': Path(repo_path).name,
    }
    try:
        result = subprocess.run(
            ['gh', 'pr', 'view', '--json', 'url,number,title'],
            capture_output=True, text=True, cwd=repo_path, timeout=5
        )
        if result.returncode == 0:
            meta['pr'] = json.loads(result.stdout)
    except Exception:
        pass
    return meta


def get_file_lines(repo_path, filepath, start, count, direction='down'):
    full_path = Path(repo_path) / filepath
    if not full_path.exists():
        return []
    lines = full_path.read_text().splitlines()
    if direction == 'up':
        end = max(start - 1, 0)
        begin = max(end - count, 0)
        return [{'num': i + 1, 'content': lines[i]} for i in range(begin, end)]
    else:
        begin = start
        end = min(begin + count, len(lines))
        return [{'num': i + 1, 'content': lines[i]} for i in range(begin, end)]
```

- [ ] **Step 2: Commit**

```bash
git add git_ops.py
git commit -m "extract git operations into git_ops.py"
```

---

## Task 10: Refactor server.py — Session class + serve dist/

**Files:**
- Modify: `server.py`

- [ ] **Step 1: Rewrite `server.py`**

Replace the globals with a `Session` class. Serve `frontend/dist/` in production. Keep the same API contract.

```python
#!/usr/bin/env python3
"""
Claude Code Review Server — Session-based

A single review session per branch with multiple review items:
- "diff" item (always present): the branch's code changes
- Document items: markdown/text files added dynamically for review

Usage:
    python3 server.py --repo <path> [--base <branch>] [--description <text>]
"""

import argparse
import http.server
import json
import mimetypes
import os
import threading
import webbrowser
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from git_ops import (
    detect_base_branch, get_branch_diff, get_selected_commits_diff,
    get_branch_commits, get_repo_meta, get_file_lines, git_run,
)

DIST_DIR = Path(__file__).parent / 'frontend' / 'dist'


def slugify(title):
    return title.lower().replace(' ', '-').replace('/', '-')[:40]


class Session:
    def __init__(self, repo_path, base_branch, description='', output_path=''):
        self.repo_path = repo_path
        self.base_branch = base_branch
        self.description = description
        self.output_path = output_path
        self.round = 0
        self.round_lock = threading.Lock()
        self.items = [{
            'id': 'diff',
            'type': 'diff',
            'title': 'Code Changes',
        }]
        self.items_lock = threading.Lock()
        self.claude_comments = {}
        self.claude_comments_lock = threading.Lock()


class ReviewHandler(http.server.BaseHTTPRequestHandler):
    session: Session  # set on the class before serving

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        s = self.session

        if path == '/':
            return self._serve_index()

        if path == '/items':
            return self._respond_json({'items': s.items})

        if path == '/data':
            item_id = qs.get('item', ['diff'])[0]
            return self._respond_json(self._get_item_data(item_id, qs))

        if path == '/context':
            filepath = qs.get('file', [''])[0]
            line = int(qs.get('line', ['0'])[0])
            count = int(qs.get('count', ['20'])[0])
            direction = qs.get('direction', ['down'])[0]
            return self._respond_json({
                'lines': get_file_lines(s.repo_path, filepath, line, count, direction)
            })

        if path == '/file':
            filepath = qs.get('path', [''])[0]
            full_path = Path(s.repo_path) / filepath
            lines = []
            if full_path.exists():
                for i, line in enumerate(full_path.read_text().splitlines(), 1):
                    lines.append({'num': i, 'content': line})
            return self._respond_json({'lines': lines})

        if path == '/commits':
            return self._respond_json({
                'commits': get_branch_commits(s.repo_path, s.base_branch)
            })

        # Try serving static files from dist/
        return self._serve_static(path)

    def _serve_index(self):
        index = DIST_DIR / 'index.html'
        if index.exists():
            content = index.read_text()
            self._send_content(content, 'text/html; charset=utf-8')
        else:
            self.send_response(404)
            self.end_headers()
            self._write(b'Frontend not built. Run: cd frontend && npm run build')

    def _serve_static(self, path):
        # Serve from dist/ for production
        safe_path = path.lstrip('/')
        file_path = DIST_DIR / safe_path
        if file_path.exists() and file_path.is_file():
            content_type, _ = mimetypes.guess_type(str(file_path))
            content = file_path.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', content_type or 'application/octet-stream')
            self.end_headers()
            self._write(content)
        else:
            self.send_response(404)
            self.end_headers()

    def _get_item_data(self, item_id, qs):
        s = self.session
        claude_comments = s.claude_comments.get(item_id, [])

        if item_id == 'diff':
            selected = qs.get('commits', [''])[0]
            if selected:
                shas = [sha.strip() for sha in selected.split(',') if sha.strip()]
                diff = get_selected_commits_diff(s.repo_path, shas)
            else:
                diff = get_branch_diff(s.repo_path, s.base_branch)
            return {
                'mode': 'diff',
                'diff': diff,
                'description': s.description,
                'meta': get_repo_meta(s.repo_path, s.base_branch),
                'claudeComments': claude_comments,
            }

        item = next((i for i in s.items if i['id'] == item_id), None)
        if not item:
            return {'mode': 'error', 'error': f'Item not found: {item_id}'}

        p = Path(item['path'])
        content = p.read_text() if p.exists() else ''
        is_markdown = p.name.endswith(('.md', '.mdx', '.markdown'))

        return {
            'mode': 'file',
            'content': content,
            'filename': p.name,
            'filepath': str(p),
            'markdown': is_markdown,
            'title': item.get('title', p.name),
            'claudeComments': claude_comments,
        }

    def do_POST(self):
        path = urlparse(self.path).path
        data = self._read_body()
        s = self.session

        if path == '/items':
            filepath = data.get('path', '')
            title = data.get('title', '') or Path(filepath).stem
            item_id = data.get('id', '') or slugify(title)

            with s.items_lock:
                existing = next((i for i in s.items if i['id'] == item_id), None)
                if existing:
                    existing['path'] = os.path.abspath(filepath)
                    existing['title'] = title
                else:
                    s.items.append({
                        'id': item_id,
                        'type': 'document',
                        'title': title,
                        'path': os.path.abspath(filepath),
                    })

            self._respond_json({'ok': True, 'id': item_id, 'items': s.items})
            print(f"ITEM_ADDED={item_id}", flush=True)

        elif path == '/comments':
            item_id = data.get('item', 'diff')
            new_comments = data.get('comments', [])
            with s.claude_comments_lock:
                if item_id not in s.claude_comments:
                    s.claude_comments[item_id] = []
                s.claude_comments[item_id].extend(new_comments)
            self._respond_json({'ok': True, 'count': len(s.claude_comments.get(item_id, []))})
            print(f"CLAUDE_COMMENTS_ADDED={len(new_comments)} item={item_id}", flush=True)

        elif path == '/submit':
            with s.round_lock:
                s.round += 1
                current_round = s.round

            with open(s.output_path, 'a') as f:
                f.write(f"\n---\n# Review Round {current_round}\n\n")
                f.write(data.get('comments', ''))
                f.write('\n')

            signal_path = s.output_path + '.signal'
            with open(signal_path, 'w') as f:
                f.write(str(current_round))

            self._respond_json({'ok': True, 'round': current_round})
            print(f"REVIEW_ROUND={current_round}", flush=True)

        else:
            self.send_response(404)
            self.end_headers()

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def _respond_json(self, payload):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self._write(json.dumps(payload).encode())

    def _send_content(self, content, content_type):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.end_headers()
        self._write(content.encode())

    def _write(self, data):
        try:
            self.wfile.write(data)
        except BrokenPipeError:
            pass

    def log_message(self, format, *args):
        pass


def stable_port_for_path(path):
    h = sum(ord(c) * (i + 1) for i, c in enumerate(path))
    return 9850 + (h % 100)


def main():
    parser = argparse.ArgumentParser(description='Claude Code Review Server')
    parser.add_argument('--repo', default='', help='Path to git repository')
    parser.add_argument('--base', default='', help='Base branch (default: auto-detect)')
    parser.add_argument('--commits', default='', help='Comma-separated commit SHAs')
    parser.add_argument('--description', default='', help='Review description banner')
    parser.add_argument('--output', default='', help='Output path (auto-generated if omitted)')
    parser.add_argument('--port', type=int, default=0, help='Port (0 = auto from path hash)')
    args = parser.parse_args()

    repo_path = args.repo or os.getcwd()
    base_branch = args.base or detect_base_branch(repo_path)

    port = args.port or stable_port_for_path(repo_path)

    review_dir = Path('/tmp/claude-review')
    review_dir.mkdir(exist_ok=True)
    if args.output:
        output_path = args.output
    else:
        branch = git_run(repo_path, 'rev-parse', '--abbrev-ref', 'HEAD')
        slug = branch.replace('/', '-') if branch else Path(repo_path).name
        output_path = str(review_dir / f'{slug}.md')

    with open(output_path, 'w') as f:
        f.write('')

    session = Session(
        repo_path=repo_path,
        base_branch=base_branch,
        description=args.description,
        output_path=output_path,
    )
    ReviewHandler.session = session

    server = http.server.HTTPServer(('127.0.0.1', port), ReviewHandler)
    url = f'http://127.0.0.1:{port}'

    print(f"REVIEW_URL={url}", flush=True)
    print(f"REVIEW_OUTPUT={output_path}", flush=True)
    print(f"REVIEW_PID={os.getpid()}", flush=True)

    webbrowser.open(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Commit**

```bash
git add server.py
git commit -m "refactor server.py: Session class, serve dist/, use git_ops"
```

---

## Task 11: End-to-end verification

- [ ] **Step 1: Build the frontend**

Run: `cd frontend && npm run build`

Expected: `frontend/dist/` contains `index.html` and `assets/` with bundled JS/CSS.

- [ ] **Step 2: Test production mode**

Run: `python3 server.py --repo /Users/tom/dev/claude-review`

Expected: Browser opens, shows the review UI, all features work (file list, diff rendering, comments, keyboard shortcuts, tabs).

- [ ] **Step 3: Test dev mode**

Terminal 1: `python3 server.py --repo /Users/tom/dev/claude-review --port 9870`
Terminal 2: `cd frontend && REVIEW_PORT=9870 npm run dev`

Expected: Vite dev server at localhost:5173, proxies API to Python on 9870. HMR works for CSS/TS changes.

- [ ] **Step 4: Verify all features work**

Checklist:
- Diff view renders with syntax highlighting
- Word-level diff on adjacent add/del lines
- Click line number to add comment, Cmd+Enter to save, click to edit, delete works
- File search (f key), file navigation (j/k), reviewed toggle (e key)
- Commit picker (c key), select/deselect commits, apply
- Expand context above/below hunks, auto-expand small gaps
- Show whole file / back to diff
- Tab bar shows when multiple items exist
- Document view renders markdown, block commenting works
- Submit review writes to output file
- Meta bar shows branch, base, repo path, PR link
- Description banner shows when --description is passed
- Resizable sidebar
- Comment navigation (n/p)
- Hash-based file deep linking

- [ ] **Step 5: Clean up old review.html**

Once everything works, the old `review.html` is no longer needed — the Python server no longer references it. Remove it.

```bash
git rm review.html
git commit -m "remove monolithic review.html, replaced by frontend/"
```

- [ ] **Step 6: Update README.md**

Update the Architecture section to reflect the new structure. Keep it brief.

```bash
git add README.md
git commit -m "update README for Vite + TypeScript frontend structure"
```
