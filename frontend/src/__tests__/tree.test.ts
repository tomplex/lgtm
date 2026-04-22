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

describe('buildTree — phase grouping', () => {
  const analysis: Analysis = {
    overview: '',
    reviewStrategy: '',
    files: {
      'server/app.ts': { priority: 'critical', phase: 'review', summary: '', category: '' },
      'server/log.ts': { priority: 'normal', phase: 'skim', summary: '', category: '' },
      'dist/out.js': { priority: 'low', phase: 'rubber-stamp', summary: '', category: '' },
    },
    groups: [],
  };

  it('produces three synthetic phase roots in fixed order', () => {
    const files = [makeFile('server/app.ts'), makeFile('server/log.ts'), makeFile('dist/out.js')];
    const tree = buildTree(files, analysis, { sort: 'path', group: 'phase' });
    expect(tree).toHaveLength(3);
    expect(tree.map((n) => (n as any).name)).toEqual([
      '● Review carefully',
      '◐ Skim',
      '○ Rubber stamp',
    ]);
    expect(tree.every((n) => n.kind === 'folder')).toBe(true);
  });

  it('builds an independent compact-folder subtree under each phase', () => {
    const files = [makeFile('server/app.ts'), makeFile('server/log.ts'), makeFile('dist/out.js')];
    const tree = buildTree(files, analysis, { sort: 'path', group: 'phase' });
    const reviewRoot = tree[0] as any;
    expect(reviewRoot.children).toHaveLength(1);
    expect(reviewRoot.children[0].name).toBe('server/');
    expect(reviewRoot.children[0].children).toHaveLength(1);
    expect(reviewRoot.children[0].children[0].id).toBe('review:server/app.ts');
  });

  it('omits a phase root with no files', () => {
    const files = [makeFile('server/app.ts')];
    const tree = buildTree(files, analysis, { sort: 'path', group: 'phase' });
    expect(tree).toHaveLength(1);
    expect((tree[0] as any).name).toBe('● Review carefully');
  });

  it('defaults to phase=skim when a file lacks analysis', () => {
    const files = [makeFile('unknown.ts')];
    const tree = buildTree(files, analysis, { sort: 'path', group: 'phase' });
    expect(tree).toHaveLength(1);
    expect((tree[0] as any).name).toBe('◐ Skim');
  });
});

describe('buildTree — sort', () => {
  it('sort=path orders files alphabetically within a folder, folders before files', () => {
    const files = [
      makeFile('z.ts'),
      makeFile('a.ts'),
      makeFile('sub/b.ts'),
    ];
    const tree = buildTree(files, null, { sort: 'path', group: 'none' });
    expect(tree.map((n) => (n as any).name ?? (n as any).file.path)).toEqual([
      'sub/',
      'a.ts',
      'z.ts',
    ]);
  });

  it('sort=priority orders critical → important → normal → low with path tie-break', () => {
    const analysis: Analysis = {
      overview: '', reviewStrategy: '', groups: [],
      files: {
        'b.ts': { priority: 'critical', phase: 'review', summary: '', category: '' },
        'a.ts': { priority: 'normal', phase: 'skim', summary: '', category: '' },
        'c.ts': { priority: 'critical', phase: 'review', summary: '', category: '' },
        'd.ts': { priority: 'low', phase: 'rubber-stamp', summary: '', category: '' },
      },
    };
    const files = [makeFile('a.ts'), makeFile('b.ts'), makeFile('c.ts'), makeFile('d.ts')];
    const tree = buildTree(files, analysis, { sort: 'priority', group: 'none' });
    expect(tree.map((n) => (n as any).file.path)).toEqual(['b.ts', 'c.ts', 'a.ts', 'd.ts']);
  });

  it('sort=priority falls back to path sort when analysis is null', () => {
    const files = [makeFile('z.ts'), makeFile('a.ts')];
    const tree = buildTree(files, null, { sort: 'priority', group: 'none' });
    expect(tree.map((n) => (n as any).file.path)).toEqual(['a.ts', 'z.ts']);
  });
});

describe('buildTree — Claude-comments-first', () => {
  it('floats files with claudeComments to top within their folder', () => {
    const files = [
      { ...makeFile('a.ts') },
      { ...makeFile('b.ts') },
      { ...makeFile('c.ts') },
    ];
    const claudeCommentedPaths = new Set(['c.ts']);
    const tree = buildTree(files, null, {
      sort: 'path',
      group: 'none',
      claudeCommentedPaths,
    } as any);
    expect(tree.map((n) => (n as any).file.path)).toEqual(['c.ts', 'a.ts', 'b.ts']);
  });

  it('floats claude-commented files within phase roots, per folder', () => {
    const analysis: Analysis = {
      overview: '', reviewStrategy: '', groups: [],
      files: {
        'x/a.ts': { priority: 'normal', phase: 'skim', summary: '', category: '' },
        'x/b.ts': { priority: 'normal', phase: 'skim', summary: '', category: '' },
      },
    };
    const files = [makeFile('x/a.ts'), makeFile('x/b.ts')];
    const claudeCommentedPaths = new Set(['x/b.ts']);
    const tree = buildTree(files, analysis, {
      sort: 'path', group: 'phase', claudeCommentedPaths,
    } as any);
    const skimRoot = tree[0] as any;
    const xFolder = skimRoot.children[0];
    expect(xFolder.children.map((n: any) => n.file.path)).toEqual(['x/b.ts', 'x/a.ts']);
  });
});
