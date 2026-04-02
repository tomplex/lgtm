import type { Comment } from './comment-types';
import { baseUrl } from './api';

async function checkedJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return resp.json();
}

export async function fetchComments(filter?: Record<string, string>): Promise<Comment[]> {
  const params = new URLSearchParams(filter);
  const resp = await fetch(`${baseUrl()}/comments?${params}`);
  const data = await checkedJson<{ comments: Comment[] }>(resp);
  return data.comments;
}

export async function createComment(input: {
  author: 'user' | 'claude';
  text: string;
  item: string;
  file?: string;
  line?: number;
  block?: number;
  parentId?: string;
  mode?: 'review' | 'direct';
}): Promise<Comment> {
  const resp = await fetch(`${baseUrl()}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await checkedJson<{ ok: boolean; comment: Comment }>(resp);
  return data.comment;
}

export async function updateComment(id: string, fields: { text?: string; status?: string }): Promise<Comment> {
  const resp = await fetch(`${baseUrl()}/comments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await checkedJson<{ ok: boolean; comment: Comment }>(resp);
  return data.comment;
}

export async function deleteComment(id: string): Promise<void> {
  const resp = await fetch(`${baseUrl()}/comments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await checkedJson<{ ok: boolean }>(resp);
}
