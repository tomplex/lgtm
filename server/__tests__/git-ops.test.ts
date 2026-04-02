import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import {
  gitRun,
  detectBaseBranch,
  getBranchDiff,
  getSelectedCommitsDiff,
  getBranchCommits,
  getRepoMeta,
  getFileLines,
} from '../git-ops.js';

describe('git-ops', () => {
  let fixture: GitFixture;

  beforeAll(() => {
    fixture = createGitFixture();
  });

  afterAll(() => {
    fixture.cleanup();
  });

  describe('gitRun', () => {
    it('returns stdout from git command', () => {
      const result = gitRun(fixture.repoPath, 'rev-parse', '--abbrev-ref', 'HEAD');
      expect(result).toBe('feature');
    });

    it('throws on invalid repo path', () => {
      expect(() => gitRun('/tmp/nonexistent-repo', 'status')).toThrow();
    });
  });

  describe('detectBaseBranch', () => {
    it('returns main when main branch exists', () => {
      expect(detectBaseBranch(fixture.repoPath)).toBe('main');
    });
  });

  describe('getBranchDiff', () => {
    it('returns unified diff with additions and deletions', () => {
      const diff = getBranchDiff(fixture.repoPath, 'main');
      expect(diff).toContain('diff --git');
      expect(diff).toContain('src/app.ts');
      expect(diff).toContain('src/utils.ts');
      // Should contain the goodbye addition
      expect(diff).toContain('+import { hello, goodbye }');
    });

    it('returns empty string when no changes', () => {
      const diff = getBranchDiff(fixture.repoPath, 'feature');
      // Comparing branch to itself — merge-base is HEAD, no diff files
      expect(diff).toBe('');
    });
  });

  describe('getSelectedCommitsDiff', () => {
    it('returns diff for specific commit SHAs', () => {
      const diff = getSelectedCommitsDiff(fixture.repoPath, [fixture.featureCommits[0]]);
      expect(diff).toContain('src/app.ts');
      expect(diff).toContain('goodbye');
      // Should NOT contain utils.ts (that's in the second commit)
      expect(diff).not.toContain('src/utils.ts');
    });

    it('returns diff for multiple commits', () => {
      const diff = getSelectedCommitsDiff(fixture.repoPath, fixture.featureCommits);
      expect(diff).toContain('src/app.ts');
      expect(diff).toContain('src/utils.ts');
    });
  });

  describe('getBranchCommits', () => {
    it('returns commits on feature branch', () => {
      const commits = getBranchCommits(fixture.repoPath, 'main');
      expect(commits).toHaveLength(2);
      expect(commits[0].message).toBe('add utils module');
      expect(commits[1].message).toBe('add goodbye call');
      expect(commits[0].author).toBe('Test User');
      expect(commits[0].sha).toHaveLength(40);
      expect(commits[0].date).toBeTruthy();
    });
  });

  describe('getRepoMeta', () => {
    it('returns branch and repo info', () => {
      const meta = getRepoMeta(fixture.repoPath, 'main');
      expect(meta.branch).toBe('feature');
      expect(meta.baseBranch).toBe('main');
      expect(meta.repoName).toBeTruthy();
      expect(meta.repoPath).toBe(fixture.repoPath);
    });
  });

  describe('getFileLines', () => {
    it('reads lines going down from a position', () => {
      const lines = getFileLines(fixture.repoPath, 'src/app.ts', 0, 3, 'down');
      expect(lines).toHaveLength(3);
      expect(lines[0].num).toBe(1);
      expect(lines[0].content).toContain('import');
      expect(lines[2].num).toBe(3);
    });

    it('reads lines going up from a position', () => {
      const lines = getFileLines(fixture.repoPath, 'src/app.ts', 5, 3, 'up');
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[lines.length - 1].num).toBeLessThanOrEqual(5);
    });

    it('returns empty array for nonexistent file', () => {
      const lines = getFileLines(fixture.repoPath, 'nonexistent.ts', 0, 5);
      expect(lines).toEqual([]);
    });
  });
});
