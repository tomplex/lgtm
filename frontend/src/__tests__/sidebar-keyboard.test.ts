import { describe, it, expect } from 'vitest';
import {
  nextRow,
  prevRow,
  nextFolder,
  prevFolder,
  folderOf,
} from '../hooks/useKeyboardShortcuts-helpers';
import type { TreeNode } from '../tree';

function folder(id: string, depth: number): TreeNode {
  return { kind: 'folder', id, name: id, fullPath: id, depth, children: [] } as TreeNode;
}
function file(id: string, depth: number): TreeNode {
  return { kind: 'file', id, file: { path: id, additions: 0, deletions: 0, lines: [] }, depth } as TreeNode;
}

describe('keyboard helpers', () => {
  const rows: TreeNode[] = [
    folder('a/', 0),
    file('a/x.ts', 1),
    file('a/y.ts', 1),
    folder('b/', 0),
    file('b/z.ts', 1),
  ];

  it('nextRow moves through files and folders in order', () => {
    expect(nextRow(rows, 'a/')).toBe('a/x.ts');
    expect(nextRow(rows, 'a/x.ts')).toBe('a/y.ts');
    expect(nextRow(rows, 'a/y.ts')).toBe('b/');
    expect(nextRow(rows, 'b/z.ts')).toBeNull();
  });

  it('prevRow goes back across folders and files', () => {
    expect(prevRow(rows, 'a/x.ts')).toBe('a/');
    expect(prevRow(rows, 'a/')).toBeNull();
    expect(prevRow(rows, 'b/')).toBe('a/y.ts');
  });

  it('nextFolder / prevFolder jump between folder rows', () => {
    expect(nextFolder(rows, 'a/')).toBe('b/');
    expect(nextFolder(rows, 'a/x.ts')).toBe('b/');
    expect(nextFolder(rows, 'b/z.ts')).toBeNull();
    expect(prevFolder(rows, 'b/z.ts')).toBe('b/');
    expect(prevFolder(rows, 'b/')).toBe('a/');
  });

  it('folderOf returns the parent folder row id for a file', () => {
    expect(folderOf(rows, 'a/x.ts')).toBe('a/');
    expect(folderOf(rows, 'b/z.ts')).toBe('b/');
    expect(folderOf(rows, 'a/')).toBe('a/'); // folder itself
  });
});
