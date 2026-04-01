import type { SessionItem, Commit, RepoMeta, ClaudeComment, Analysis } from './state';

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
    } catch { /* ignore parse failure */ }
    throw new Error(message);
  }
  return resp.json();
}

interface UserState {
  comments: Record<string, string>;
  reviewedFiles: string[];
  resolvedComments: string[];
  sidebarView: string;
}

interface DiffData {
  mode: 'diff';
  diff: string;
  description: string;
  meta: RepoMeta;
  claudeComments: ClaudeComment[];
}

interface FileData {
  mode: 'file';
  content: string;
  filename: string;
  filepath: string;
  markdown: boolean;
  title: string;
  claudeComments: ClaudeComment[];
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

export async function fetchFile(filepath: string): Promise<{ num: number; content: string }[]> {
  const resp = await fetch(`${baseUrl()}/file?path=${encodeURIComponent(filepath)}`);
  const data = await checkedJson<{ lines?: { num: number; content: string }[] }>(resp);
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
  return checkedJson<{ ok: boolean; round: number }>(resp);
}

export async function deleteClaudeComment(itemId: string, index: number): Promise<void> {
  const resp = await fetch(`${baseUrl()}/comments?item=${encodeURIComponent(itemId)}&index=${index}`, { method: 'DELETE' });
  await checkedJson<{ ok: boolean }>(resp);
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

export async function putUserComment(key: string, text: string | null): Promise<void> {
  await fetch(`${baseUrl()}/user-state/comment`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, text }),
  });
}

export async function putUserReviewed(path: string): Promise<void> {
  await fetch(`${baseUrl()}/user-state/reviewed`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

export async function putUserResolved(key: string): Promise<void> {
  await fetch(`${baseUrl()}/user-state/resolved`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
}

export async function putUserSidebarView(view: string): Promise<void> {
  await fetch(`${baseUrl()}/user-state/sidebar-view`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ view }),
  });
}

export async function clearUserState(): Promise<void> {
  await fetch(`${baseUrl()}/user-state/clear`, { method: 'POST' });
}
