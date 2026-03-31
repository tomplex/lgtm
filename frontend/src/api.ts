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

export async function deleteClaudeComments(itemId?: string): Promise<void> {
  const url = itemId ? `/comments?item=${encodeURIComponent(itemId)}` : '/comments';
  await fetch(url, { method: 'DELETE' });
}
