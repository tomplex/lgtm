import { describe, it, expect } from 'vitest';
import { buildTree } from '../tree';
import type { DiffFile, Analysis } from '../state';

function makeFile(path: string, additions = 10, deletions = 5): DiffFile {
  return { path, additions, deletions, lines: [] };
}

describe('buildTree — empty and flat', () => {
  it('returns [] for no files', () => {
    const tree = buildTree([], null, { sort: 'path', group: 'none' });
    expect(tree).toEqual([]);
  });

  it('produces a single flat file list when no directories', () => {
    const files = [makeFile('a.ts'), makeFile('b.ts')];
    const tree = buildTree(files, null, { sort: 'path', group: 'none' });
    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({ kind: 'file', id: 'a.ts' });
    expect(tree[1]).toMatchObject({ kind: 'file', id: 'b.ts' });
  });

  it('produces nested folders for single-level paths', () => {
    const files = [makeFile('server/app.ts'), makeFile('server/session.ts')];
    const tree = buildTree(files, null, { sort: 'path', group: 'none' });
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ kind: 'folder', name: 'server/', fullPath: 'server/', depth: 0 });
    expect(tree[0].kind === 'folder' && tree[0].children).toHaveLength(2);
  });
});
