import type { Comment } from './comment-types.js';

interface OldClaudeComment {
  id: string;
  file?: string;
  line?: number;
  side?: string;
  block?: number;
  comment: string;
}

interface OldBlob {
  claudeComments?: Record<string, OldClaudeComment[]>;
  userComments?: Record<string, string>;
  resolvedComments?: string[];
  [key: string]: unknown;
}

interface NewBlob {
  comments: Comment[];
  [key: string]: unknown;
}

export function migrateBlob(blob: Record<string, unknown>): NewBlob {
  // Already new format
  if (Array.isArray(blob.comments)) {
    return blob as unknown as NewBlob;
  }

  const old = blob as OldBlob;
  const comments: Comment[] = [];
  const resolvedSet = new Set(old.resolvedComments ?? []);

  // Migrate Claude comments
  for (const [itemId, ccs] of Object.entries(old.claudeComments ?? {})) {
    for (const cc of ccs) {
      comments.push({
        id: cc.id,
        author: 'claude',
        text: cc.comment,
        status: resolvedSet.has(`claude:${cc.id}`) ? 'resolved' : 'active',
        item: itemId,
        file: cc.file,
        line: cc.line,
        block: cc.block,
      });
    }
  }

  // Migrate user comments
  for (const [key, text] of Object.entries(old.userComments ?? {})) {
    // Reply to Claude comment: "claude:{id}"
    if (key.startsWith('claude:')) {
      const parentId = key.slice('claude:'.length);
      const parent = comments.find(c => c.id === parentId);
      comments.push({
        id: crypto.randomUUID(),
        author: 'user',
        text,
        status: 'active',
        parentId,
        item: parent?.item ?? 'diff',
      });
      continue;
    }

    // Document comment: "doc:{itemId}:{blockIdx}"
    if (key.startsWith('doc:')) {
      const parts = key.split(':');
      const itemId = parts[1];
      const blockIdx = parseInt(parts[2]);
      comments.push({
        id: crypto.randomUUID(),
        author: 'user',
        text,
        status: 'active',
        item: itemId,
        block: blockIdx,
        mode: 'review',
      });
      continue;
    }

    // Markdown block comment: "md::{blockIdx}"
    if (key.startsWith('md::')) {
      const blockIdx = parseInt(key.slice('md::'.length));
      comments.push({
        id: crypto.randomUUID(),
        author: 'user',
        text,
        status: 'active',
        item: 'diff',
        block: blockIdx,
        mode: 'review',
      });
      continue;
    }

    // Diff line comment: "filepath::lineIdx"
    const sepIdx = key.lastIndexOf('::');
    if (sepIdx > 0) {
      const filePath = key.substring(0, sepIdx);
      const lineIdx = parseInt(key.substring(sepIdx + 2));
      comments.push({
        id: crypto.randomUUID(),
        author: 'user',
        text,
        status: 'active',
        item: 'diff',
        file: filePath,
        line: lineIdx,
        mode: 'review',
      });
    }
  }

  // Build new blob, removing old fields
  const { claudeComments: _, userComments: __, resolvedComments: ___, ...rest } = old;
  return { ...rest, comments } as unknown as NewBlob;
}
