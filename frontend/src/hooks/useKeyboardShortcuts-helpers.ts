import type { TreeNode } from '../tree';

export function nextRow(rows: TreeNode[], currentId: string | null): string | null {
  if (!currentId) return rows[0]?.id ?? null;
  const i = rows.findIndex((r) => r.id === currentId);
  if (i < 0) return rows[0]?.id ?? null;
  return rows[i + 1]?.id ?? null;
}

export function prevRow(rows: TreeNode[], currentId: string | null): string | null {
  if (!currentId) return null;
  const i = rows.findIndex((r) => r.id === currentId);
  if (i <= 0) return null;
  return rows[i - 1].id;
}

export function nextFolder(rows: TreeNode[], currentId: string | null): string | null {
  const start = currentId ? rows.findIndex((r) => r.id === currentId) : -1;
  for (let i = start + 1; i < rows.length; i++) {
    if (rows[i].kind === 'folder') return rows[i].id;
  }
  return null;
}

export function prevFolder(rows: TreeNode[], currentId: string | null): string | null {
  const start = currentId ? rows.findIndex((r) => r.id === currentId) : rows.length;
  for (let i = start - 1; i >= 0; i--) {
    if (rows[i].kind === 'folder') return rows[i].id;
  }
  return null;
}

export function folderOf(rows: TreeNode[], currentId: string | null): string | null {
  if (!currentId) return null;
  const i = rows.findIndex((r) => r.id === currentId);
  if (i < 0) return null;
  if (rows[i].kind === 'folder') return rows[i].id;
  // Walk back to find the most recent row whose depth is less than this file's depth.
  const depth = rows[i].depth;
  for (let k = i - 1; k >= 0; k--) {
    if (rows[k].kind === 'folder' && rows[k].depth < depth) return rows[k].id;
  }
  return null;
}
