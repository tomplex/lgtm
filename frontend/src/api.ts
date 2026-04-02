import type { SessionItem, Commit, RepoMeta, Analysis } from './state';
import type { Comment } from './comment-types';

function getProjectSlug(): string {
  const match = window.location.pathname.match(/^\/project\/([^/]+)/);
  return match?.[1] ?? '';
}

export function baseUrl(): string {
  const slug = getProjectSlug();
  return slug ? `/project/${slug}` : '';
}

async function checkedJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      if (body.error) message = body.error;
    } catch {
      /* ignore parse failure */
    }
    throw new Error(message);
  }
  return resp.json();
}

interface UserState {
  reviewedFiles: string[];
  sidebarView: string;
}

interface DiffData {
  mode: 'diff';
  diff: string;
  description: string;
  meta: RepoMeta;
  comments: Comment[];
}

interface FileData {
  mode: 'file';
  content: string;
  filename: string;
  filepath: string;
  markdown: boolean;
  title: string;
  comments: Comment[];
}

interface ErrorData {
  mode: 'error';
  error: string;
}

type ItemData = DiffData | FileData | ErrorData;

export async function fetchItems(): Promise<SessionItem[]> {
  const resp = await fetch(`${baseUrl()}/items`);
  const data = await checkedJson<{ items?: SessionItem[] }>(resp);
  return data.items || [];
}

export async function fetchItemData(itemId: string, commits?: string): Promise<ItemData> {
  let url = `${baseUrl()}/data?item=${encodeURIComponent(itemId)}`;
  if (commits) url += `&commits=${commits}`;
  const resp = await fetch(url);
  return checkedJson<ItemData>(resp);
}

export async function fetchCommits(): Promise<Commit[]> {
  const resp = await fetch(`${baseUrl()}/commits`);
  const data = await checkedJson<{ commits?: Commit[] }>(resp);
  return data.commits || [];
}

export async function fetchContext(
  filepath: string,
  line: number,
  count: number,
  direction: string,
): Promise<{ num: number; content: string }[]> {
  const resp = await fetch(
    `${baseUrl()}/context?file=${encodeURIComponent(filepath)}&line=${line}&count=${count}&direction=${direction}`,
  );
  const data = await checkedJson<{ lines?: { num: number; content: string }[] }>(resp);
  return data.lines || [];
}

export async function fetchRepoFiles(glob = '**/*.md'): Promise<string[]> {
  const resp = await fetch(`${baseUrl()}/files?glob=${encodeURIComponent(glob)}`);
  const data = await checkedJson<{ files?: string[] }>(resp);
  return data.files || [];
}

export async function addItem(filepath: string, title?: string): Promise<void> {
  await fetch(`${baseUrl()}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filepath, title }),
  });
}

export async function removeItem(itemId: string): Promise<void> {
  await fetch(`${baseUrl()}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
}

export async function fetchFile(filepath: string): Promise<{ num: number; content: string }[]> {
  const resp = await fetch(`${baseUrl()}/file?path=${encodeURIComponent(filepath)}`);
  const data = await checkedJson<{ lines?: { num: number; content: string }[] }>(resp);
  return data.lines || [];
}

export async function submitReview(
  comments: string,
  raw: Record<string, string>,
  item?: string,
): Promise<{ ok: boolean; round: number }> {
  const resp = await fetch(`${baseUrl()}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comments, raw, item }),
  });
  return checkedJson<{ ok: boolean; round: number }>(resp);
}

export async function fetchAnalysis(): Promise<Analysis | null> {
  const resp = await fetch(`${baseUrl()}/analysis`);
  const data = await checkedJson<{ analysis?: Analysis | null }>(resp);
  return data.analysis || null;
}

export async function fetchUserState(): Promise<UserState> {
  const resp = await fetch(`${baseUrl()}/user-state`);
  return checkedJson<UserState>(resp);
}

export async function putUserReviewed(path: string): Promise<void> {
  await fetch(`${baseUrl()}/user-state/reviewed`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

export async function putUserSidebarView(view: string): Promise<void> {
  await fetch(`${baseUrl()}/user-state/sidebar-view`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ view }),
  });
}

export interface SymbolResult {
  file: string;
  line: number;
  kind: string;
  body: string;
  docstring: string | null;
}

interface SymbolResponse {
  symbol: string;
  results: SymbolResult[];
}

export async function fetchSymbol(name: string): Promise<SymbolResponse> {
  const resp = await fetch(`${baseUrl()}/symbol?name=${encodeURIComponent(name)}`);
  return checkedJson<SymbolResponse>(resp);
}
