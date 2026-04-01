import type { SessionItem, Commit, RepoMeta, ClaudeComment, Analysis } from './state';

function getProjectSlug(): string {
  const match = window.location.pathname.match(/^\/project\/([^/]+)/);
  return match?.[1] ?? '';
}

function baseUrl(): string {
  const slug = getProjectSlug();
  return slug ? `/project/${slug}` : '';
}

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
  const resp = await fetch(`${baseUrl()}/items`);
  const data = await resp.json();
  return data.items || [];
}

export async function fetchItemData(itemId: string, commits?: string): Promise<ItemData> {
  let url = `${baseUrl()}/data?item=${encodeURIComponent(itemId)}`;
  if (commits) url += `&commits=${commits}`;
  const resp = await fetch(url);
  return resp.json();
}

export async function fetchCommits(): Promise<Commit[]> {
  const resp = await fetch(`${baseUrl()}/commits`);
  const data = await resp.json();
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
  const data = await resp.json();
  return data.lines || [];
}

export async function fetchFile(filepath: string): Promise<{ num: number; content: string }[]> {
  const resp = await fetch(`${baseUrl()}/file?path=${encodeURIComponent(filepath)}`);
  const data = await resp.json();
  return data.lines || [];
}

export async function submitReview(
  comments: string,
  raw: Record<string, string>,
): Promise<{ ok: boolean; round: number }> {
  const resp = await fetch(`${baseUrl()}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comments, raw }),
  });
  return resp.json();
}

export async function deleteClaudeComment(itemId: string, index: number): Promise<void> {
  await fetch(`${baseUrl()}/comments?item=${encodeURIComponent(itemId)}&index=${index}`, { method: 'DELETE' });
}

export async function deleteAllClaudeComments(itemId?: string): Promise<void> {
  const url = itemId ? `${baseUrl()}/comments?item=${encodeURIComponent(itemId)}` : `${baseUrl()}/comments`;
  await fetch(url, { method: 'DELETE' });
}

export async function fetchAnalysis(): Promise<Analysis | null> {
  const resp = await fetch(`${baseUrl()}/analysis`);
  const data = await resp.json();
  return data.analysis || null;
}
