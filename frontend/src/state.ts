import { createSignal, createMemo } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { Comment } from './comment-types';

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

export type SidebarView = 'flat' | 'grouped' | 'phased';

// --- Signals (replaced wholesale) ---

export const [files, setFiles] = createSignal<DiffFile[]>([]);
export const [activeFileIdx, setActiveFileIdx] = createSignal(0);
export const [activeItemId, setActiveItemId] = createSignal('diff');
export const [appMode, setAppMode] = createSignal<'diff' | 'file'>('diff');
export const [wholeFileView, setWholeFileView] = createSignal(false);
export const [sidebarView, setSidebarView] = createSignal<SidebarView>('flat');
export const [repoMeta, setRepoMeta] = createSignal<RepoMeta>({});
export const [mdMeta, setMdMeta] = createSignal<MdMeta>({});
export const [sessionItems, setSessionItems] = createSignal<SessionItem[]>([]);
export const [allCommits, setAllCommits] = createSignal<Commit[]>([]);
export const [analysis, setAnalysis] = createSignal<Analysis | null>(null);

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
        if (num) { targetLineNum = parseInt(num); break; }
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
}

export const [peekState, setPeekState] = createSignal<PeekState | null>(null);

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

// --- Derived state ---

export const activeFile = createMemo(() => files()[activeFileIdx()]);

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
