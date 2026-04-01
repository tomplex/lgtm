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
  side?: 'new' | 'old';
  block?: number;
  comment: string;
  _item: string;
  _serverIndex: number;
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
export const resolvedComments = new Set<string>();
export let wholeFileView = false;
export let analysis: Analysis | null = null;
export let sidebarView: SidebarView = 'flat';

// Line ID tracking
let lineIdCounter = 0;
const lineKeyToId: Record<string, string> = {};

export function getLineId(lineKey: string): string {
  if (!lineKeyToId[lineKey]) lineKeyToId[lineKey] = 'lc-' + lineIdCounter++;
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
export function setFiles(f: DiffFile[]) {
  files = f;
}
export function setActiveFileIdx(i: number) {
  activeFileIdx = i;
}
export function setAppMode(m: 'diff' | 'file') {
  appMode = m;
}
export function setMdMeta(m: MdMeta) {
  mdMeta = m;
}
export function setRepoMeta(m: RepoMeta) {
  repoMeta = m;
}
export function setClaudeComments(c: ClaudeComment[]) {
  claudeComments = c;
}
export function setSessionItems(items: SessionItem[]) {
  sessionItems = items;
}
export function setActiveItemId(id: string) {
  activeItemId = id;
}
export function setAllCommits(c: Commit[]) {
  allCommits = c;
}
export function setWholeFileView(v: boolean) {
  wholeFileView = v;
}
export function setAnalysis(a: Analysis | null) { analysis = a; }
export function setSidebarView(v: SidebarView) { sidebarView = v; }
