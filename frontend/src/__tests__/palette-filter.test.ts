import { describe, it, expect } from 'vitest';
import { filterProjects } from '../components/palette/filter';
import type { ProjectSummary } from '../api';

const FIXTURES: ProjectSummary[] = [
  {
    slug: 'claude-review',
    repoPath: '/Users/tom/dev/claude-review',
    repoName: 'claude-review',
    description: 'LGTM tool',
    branch: 'main',
    baseBranch: 'main',
    pr: null,
    claudeCommentCount: 0,
    userCommentCount: 0,
  },
  {
    slug: 'plugin-dev',
    repoPath: '/Users/tom/dev/plugin-dev',
    repoName: 'plugin-dev',
    description: '',
    branch: 'main',
    baseBranch: 'main',
    pr: null,
    claudeCommentCount: 0,
    userCommentCount: 0,
  },
  {
    slug: 'anthology',
    repoPath: '/Users/tom/dev/anthology',
    repoName: 'anthology',
    description: 'Content pipeline',
    branch: 'feature',
    baseBranch: 'main',
    pr: null,
    claudeCommentCount: 2,
    userCommentCount: 0,
  },
];

describe('filterProjects', () => {
  it('returns full list for empty or whitespace query', () => {
    expect(filterProjects(FIXTURES, '')).toHaveLength(3);
    expect(filterProjects(FIXTURES, '   ')).toHaveLength(3);
  });

  it('matches subsequence case-insensitively across repoName and slug', () => {
    const out = filterProjects(FIXTURES, 'CLREV');
    expect(out.map((p) => p.slug)).toEqual(['claude-review']);
  });

  it('matches against description', () => {
    const out = filterProjects(FIXTURES, 'pipeline');
    expect(out.map((p) => p.slug)).toEqual(['anthology']);
  });

  it('matches against repoPath', () => {
    const out = filterProjects(FIXTURES, 'plugin');
    expect(out.map((p) => p.slug)).toEqual(['plugin-dev']);
  });

  it('returns empty when no project matches', () => {
    expect(filterProjects(FIXTURES, 'zzz')).toEqual([]);
  });
});
