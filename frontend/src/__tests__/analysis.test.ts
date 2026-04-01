import { describe, it, expect } from 'vitest';
import { sortFilesByPriority, groupFiles, phaseFiles } from '../analysis';
import type { DiffFile, Analysis } from '../state';

function makeFile(path: string): DiffFile {
  return { path, additions: 10, deletions: 5, lines: [] };
}

const ANALYSIS: Analysis = {
  overview: 'Test overview',
  reviewStrategy: 'Test strategy',
  files: {
    'core.ts': { priority: 'critical', phase: 'review', summary: 'Core logic', category: 'core' },
    'utils.ts': { priority: 'normal', phase: 'skim', summary: 'Utility helpers', category: 'util' },
    'types.ts': { priority: 'low', phase: 'rubber-stamp', summary: 'Type exports', category: 'types' },
    'auth.ts': { priority: 'important', phase: 'review', summary: 'Auth check', category: 'core' },
  },
  groups: [
    { name: 'Core', files: ['core.ts', 'auth.ts'] },
    { name: 'Support', files: ['utils.ts'] },
  ],
};

const FILES = [
  makeFile('utils.ts'),
  makeFile('types.ts'),
  makeFile('core.ts'),
  makeFile('auth.ts'),
  makeFile('unknown.ts'),
];

describe('sortFilesByPriority', () => {
  it('sorts files by priority order: critical > important > normal > low', () => {
    const sorted = sortFilesByPriority(FILES, ANALYSIS);
    expect(sorted.map(f => f.path)).toEqual([
      'core.ts', 'auth.ts', 'utils.ts', 'types.ts', 'unknown.ts',
    ]);
  });

  it('preserves diff order within same priority', () => {
    const analysis: Analysis = {
      ...ANALYSIS,
      files: {
        'a.ts': { priority: 'normal', phase: 'skim', summary: '', category: '' },
        'b.ts': { priority: 'normal', phase: 'skim', summary: '', category: '' },
      },
    };
    const files = [makeFile('b.ts'), makeFile('a.ts')];
    const sorted = sortFilesByPriority(files, analysis);
    expect(sorted.map(f => f.path)).toEqual(['b.ts', 'a.ts']);
  });

  it('puts unanalyzed files at the end', () => {
    const sorted = sortFilesByPriority(FILES, ANALYSIS);
    expect(sorted[sorted.length - 1].path).toBe('unknown.ts');
  });
});

describe('groupFiles', () => {
  it('groups files by analysis groups', () => {
    const groups = groupFiles(FILES, ANALYSIS);
    expect(groups.map(g => g.name)).toEqual(['Core', 'Support', 'Other']);
  });

  it('puts ungrouped files in Other', () => {
    const groups = groupFiles(FILES, ANALYSIS);
    const other = groups.find(g => g.name === 'Other')!;
    expect(other.files.map(f => f.path)).toContain('types.ts');
    expect(other.files.map(f => f.path)).toContain('unknown.ts');
  });

  it('omits Other group when all files are grouped', () => {
    const allGrouped: Analysis = {
      ...ANALYSIS,
      groups: [
        { name: 'All', files: ['core.ts', 'auth.ts', 'utils.ts', 'types.ts', 'unknown.ts'] },
      ],
    };
    const groups = groupFiles(FILES, allGrouped);
    expect(groups.map(g => g.name)).toEqual(['All']);
  });
});

describe('phaseFiles', () => {
  it('partitions files into three phases', () => {
    const phases = phaseFiles(FILES, ANALYSIS);
    expect(phases.review.map(f => f.path)).toEqual(['core.ts', 'auth.ts']);
    expect(phases.skim.map(f => f.path)).toContain('utils.ts');
    expect(phases['rubber-stamp'].map(f => f.path)).toEqual(['types.ts']);
  });

  it('puts unanalyzed files in skim', () => {
    const phases = phaseFiles(FILES, ANALYSIS);
    expect(phases.skim.map(f => f.path)).toContain('unknown.ts');
  });
});
