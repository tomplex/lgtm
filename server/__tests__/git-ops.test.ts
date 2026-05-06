import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import {
  gitRun,
  detectBaseBranch,
  getBranchDiff,
  getBranchDiffRaw,
  getSelectedCommitsDiff,
  getBranchCommits,
  getRepoMeta,
  getFileLines,
  parseOwnerRepo,
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

describe('getBranchDiffRaw', () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'lgtm-rawdiff-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    // Pin default branch so tests don't rely on user's init.defaultBranch config.
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(join(repo, 'kept.txt'), 'unchanged\n');
    writeFileSync(join(repo, 'removed.txt'), 'will be removed\n');
    writeFileSync(join(repo, 'modified.txt'), 'old\n');
    writeFileSync(join(repo, 'old-name.txt'), 'rename me\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(join(repo, 'modified.txt'), 'new\n');
    writeFileSync(join(repo, 'added.txt'), 'fresh file\n');
    execFileSync('rm', [join(repo, 'removed.txt')]);
    git('mv', 'old-name.txt', 'new-name.txt');
    git('add', '-A');
    git('commit', '-q', '-m', 'feature work');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('returns a map of path -> {oldBlob, newBlob, status} for branch changes', () => {
    const result = getBranchDiffRaw(repo, 'main');
    expect(result.has('modified.txt')).toBe(true);
    const m = result.get('modified.txt')!;
    expect(m.status).toBe('M');
    expect(m.oldBlob).toMatch(/^[0-9a-f]{40}$/);
    expect(m.newBlob).toMatch(/^[0-9a-f]{40}$/);
    expect(m.oldBlob).not.toBe(m.newBlob);
  });

  it('marks added files with zero old-blob', () => {
    const result = getBranchDiffRaw(repo, 'main');
    const a = result.get('added.txt')!;
    expect(a.status).toBe('A');
    expect(a.oldBlob).toBe('0000000000000000000000000000000000000000');
  });

  it('marks deleted files with zero new-blob', () => {
    const result = getBranchDiffRaw(repo, 'main');
    const d = result.get('removed.txt')!;
    expect(d.status).toBe('D');
    expect(d.newBlob).toBe('0000000000000000000000000000000000000000');
  });

  it('omits files unchanged on the branch', () => {
    const result = getBranchDiffRaw(repo, 'main');
    expect(result.has('kept.txt')).toBe(false);
  });

  it('keys renames by new path with R-prefixed status', () => {
    const result = getBranchDiffRaw(repo, 'main');
    expect(result.has('new-name.txt')).toBe(true);
    expect(result.has('old-name.txt')).toBe(false);
    const r = result.get('new-name.txt')!;
    expect(r.status).toMatch(/^R/);
    expect(r.oldBlob).toMatch(/^[0-9a-f]{40}$/);
    expect(r.newBlob).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('parseOwnerRepo', () => {
  it('parses owner and repo from GitHub PR URL', () => {
    const result = parseOwnerRepo('https://github.com/tomplex/lgtm/pull/42');
    expect(result).toEqual({ owner: 'tomplex', repo: 'lgtm' });
  });

  it('returns undefined for non-GitHub URLs', () => {
    expect(parseOwnerRepo('https://gitlab.com/foo/bar/merge_requests/1')).toBeUndefined();
  });

  it('returns undefined for malformed URLs', () => {
    expect(parseOwnerRepo('not-a-url')).toBeUndefined();
  });
});
