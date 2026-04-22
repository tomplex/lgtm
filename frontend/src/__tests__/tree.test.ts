import { describe, it, expect } from 'vitest';
import { buildTree } from '../tree';
import type { DiffFile } from '../state';

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

describe('buildTree — compact folders', () => {
  it('merges single-child directory chains', () => {
    const files = [makeFile('frontend/src/components/sidebar/FileList.tsx')];
    const tree = buildTree(files, null, { sort: 'path', group: 'none' });
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      kind: 'folder',
      name: 'frontend/src/components/sidebar/',
      fullPath: 'frontend/src/components/sidebar/',
      depth: 0,
    });
  });

  it('stops merging when a chain branches', () => {
    const files = [
      makeFile('frontend/src/a.ts'),
      makeFile('frontend/dist/b.js'),
    ];
    const tree = buildTree(files, null, { sort: 'path', group: 'none' });
    expect(tree).toHaveLength(1);
    const frontend = tree[0] as any;
    expect(frontend.name).toBe('frontend/');
    expect(frontend.children).toHaveLength(2); // src/, dist/
  });

  it('stops merging when a directory contains files', () => {
    // frontend/ has its own file → cannot merge with src/
    const files = [
      makeFile('frontend/README.md'),
      makeFile('frontend/src/app.ts'),
    ];
    const tree = buildTree(files, null, { sort: 'path', group: 'none' });
    expect(tree).toHaveLength(1);
    const frontend = tree[0] as any;
    expect(frontend.name).toBe('frontend/');
    expect(frontend.children).toHaveLength(2); // src/ folder + README.md file
    const srcFolder = frontend.children.find((c: any) => c.kind === 'folder');
    expect(srcFolder.name).toBe('src/');
  });
});
