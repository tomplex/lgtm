import { createSignal, createMemo, createEffect, untrack } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { Comment } from './comment-types';
import type { Walkthrough } from './walkthrough-types';
import { buildTree, flattenVisible, type TreeNode } from './tree';

// --- Types (re-exported for consumers) ---

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

export interface RepoMeta {
  branch?: string;
  baseBranch?: string;
  repoPath?: string;
  repoName?: string;
  pr?: { url: string; number: number; title: string; owner: string; repo: string };
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

interface FileAnalysis {
  priority: 'critical' | 'important' | 'normal' | 'low';
  phase: 'review' | 'skim' | 'rubber-stamp';
  summary: string;
  category: string;
}

interface AnalysisGroup {
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

export type Language = 'python' | 'typescript' | 'rust';
export type LspStatus = 'ok' | 'indexing' | 'missing' | 'crashed' | 'partial';

// --- Signals (replaced wholesale) ---

export const [files, setFiles] = createSignal<DiffFile[]>([]);
export const [activeItemId, setActiveItemId] = createSignal('diff');
export const [appMode, setAppMode] = createSignal<'diff' | 'file'>('diff');
export const [wholeFileView, setWholeFileView] = createSignal(false);
export const [repoMeta, setRepoMeta] = createSignal<RepoMeta>({});
export const [mdMeta, setMdMeta] = createSignal<MdMeta>({});
export const [sessionItems, setSessionItems] = createSignal<SessionItem[]>([]);
export const [allCommits, setAllCommits] = createSignal<Commit[]>([]);
export const [analysis, setAnalysis] = createSignal<Analysis | null>(null);

export type SortMode = 'path' | 'priority';
export type GroupMode = 'none' | 'phase';

export const [sortMode, setSortMode] = createSignal<SortMode>('path');
export const [groupMode, setGroupMode] = createSignal<GroupMode>('none');
export const [groupModeUserTouched, setGroupModeUserTouched] = createSignal(false);
export const [activeRowId, setActiveRowId] = createSignal<string | null>(null);

/** Toggle between diff and whole-file view, preserving scroll position by line number. */
export function toggleWholeFileView() {
  const container = document.getElementById('diff-container');
  let targetLineNum: number | null = null;

  if (container) {
    const top = container.scrollTop;
    const rows = container.querySelectorAll<HTMLElement>('tr[data-line-idx]');
    for (const row of rows) {
      if (row.offsetTop >= top) {
        const num = row.querySelector('.line-num')?.textContent?.trim();
        if (num) {
          targetLineNum = parseInt(num);
          break;
        }
      }
    }
  }

  setWholeFileView(!wholeFileView());

  if (targetLineNum != null) {
    requestAnimationFrame(() => {
      const c = document.getElementById('diff-container');
      if (!c) return;
      const rows = c.querySelectorAll<HTMLElement>('tr[data-line-idx]');
      for (const row of rows) {
        const num = row.querySelector('.line-num')?.textContent?.trim();
        if (num && parseInt(num) >= targetLineNum!) {
          c.scrollTop = row.offsetTop;
          return;
        }
      }
    });
  }
}

export interface PeekState {
  filePath: string;
  lineIdx: number;
  symbol: string;
  /** 0-based file line on the HEAD side. Present only when we can resolve the click
   *  against on-disk content (i.e., not a pure deletion). */
  line?: number;
  /** UTF-16 code-unit offset within the line; present alongside `line`. */
  character?: number;
}

export const [peekState, setPeekState] = createSignal<PeekState | null>(null);

const [_lspStatus, _setLspStatus] = createStore<Record<Language, LspStatus>>({
  python: 'missing',
  typescript: 'missing',
  rust: 'missing',
});
export const lspStatus = _lspStatus;

export function setLspStatus(language: Language, status: LspStatus): void;
export function setLspStatus(next: Record<Language, LspStatus>): void;
export function setLspStatus(arg1: Language | Record<Language, LspStatus>, status?: LspStatus): void {
  if (typeof arg1 === 'string') _setLspStatus(arg1 as Language, status!);
  else _setLspStatus(arg1);
}

export const [symbolSearchOpen, setSymbolSearchOpen] = createSignal(false);

export const [paletteOpen, setPaletteOpen] = createSignal(false);

// --- Stores (partial updates) ---

export const [comments, setComments] = createStore<{ list: Comment[] }>({ list: [] });

export function addLocalComment(c: Comment) {
  if (!c) return;
  setComments('list', (prev) => [...prev, c]);
}

export function replaceComments(list: Comment[]) {
  setComments('list', reconcile(list));
}

export function updateLocalComment(id: string, fields: Partial<Comment>) {
  setComments('list', (item) => item.id === id, fields);
}

export function removeLocalComment(id: string) {
  setComments('list', (prev) => prev.filter((c) => c.id !== id));
}

export const [reviewedFiles, setReviewedFiles] = createStore<Record<string, boolean>>({});

export function toggleReviewed(path: string) {
  setReviewedFiles(path, (v) => !v);
}

export const [selectedShas, setSelectedShas] = createStore<Record<string, boolean>>({});

export const [collapsedFolders, setCollapsedFolders] = createStore<Record<string, boolean>>({});

/** Session-only collapse overlays (auto-collapse-on-reviewed, hash-nav force-expand). Not persisted. */
export const [sessionCollapsedFolders, setSessionCollapsedFolders] = createStore<Record<string, boolean | 'force-open'>>({});

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

// --- Effective collapse (persisted + session overlay) ---

export const effectiveCollapsedFolders = createMemo(() => {
  const out: Record<string, boolean> = { ...collapsedFolders };
  for (const k of Object.keys(sessionCollapsedFolders)) {
    const v = sessionCollapsedFolders[k];
    if (v === 'force-open') out[k] = false;
    else if (v === true) out[k] = true;
  }
  return out;
});

// --- Derived state ---

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
    collapsedFolders: effectiveCollapsedFolders(),
    dismissedFolders: dfoSet,
    dismissedFiles: dfSet,
    filterQuery: filterQuery(),
  });
});

export const activeFile = createMemo<DiffFile | null>(() => {
  const rowId = activeRowId();
  if (!rowId) return null;
  for (const row of visibleRows()) {
    if (row.kind === 'file' && row.id === rowId) return row.file;
  }
  return null;
});

export const commentsByFile = createMemo(() => {
  const result: Record<string, Comment[]> = {};
  for (const c of comments.list) {
    if (!c) continue;
    if (c.file && !c.parentId && c.status !== 'dismissed') {
      if (!result[c.file]) result[c.file] = [];
      result[c.file].push(c);
    }
  }
  return result;
});

export const userCommentCount = createMemo(
  () => comments.list.filter((c) => c?.author === 'user' && !c.parentId && c.status !== 'dismissed').length,
);

/** Resolves a file path to its current tree row id, then sets active row. */
export function setActiveFilePath(path: string | null): void {
  if (!path) {
    setActiveRowId(null);
    return;
  }
  const row = visibleRows().find((r) => r.kind === 'file' && r.file.path === path);
  setActiveRowId(row?.id ?? path);
}

/** Keep activeRowId resolvable: snap to first visible file if the current id has no row. */
export function watchActiveRowId(): void {
  createEffect(() => {
    const rows = visibleRows();
    const id = untrack(() => activeRowId());
    if (!id) return;
    const exists = rows.some((r) => r.id === id);
    if (!exists) {
      const firstFile = rows.find((r) => r.kind === 'file');
      setActiveRowId(firstFile?.id ?? null);
    }
  });
}

// --- Walkthrough ---

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

/** Files → list of stop orders that include this file in any artifact. */
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
