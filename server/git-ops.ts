import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

function gitRun(repoPath: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  }).trim();
}

export function detectBaseBranch(repoPath: string): string {
  for (const candidate of ['master', 'main']) {
    try {
      gitRun(repoPath, 'rev-parse', '--verify', candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return 'main';
}

// Intentionally includes working-tree and staged changes alongside committed
// branch changes, so the review UI reflects the live state of the checkout.
export function getBranchDiff(repoPath: string, baseBranch: string): string {
  const mergeBase = gitRun(repoPath, 'merge-base', baseBranch, 'HEAD');
  if (!mergeBase) return '';

  const filesOutput = gitRun(
    repoPath,
    'log', '--first-parent', '--no-merges',
    '--diff-filter=ACDMR', '--name-only', '--format=',
    `${baseBranch}..HEAD`,
  );
  const branchFiles = new Set(filesOutput.split('\n').filter(f => f.trim()));

  // Uncommitted and staged files are nice-to-have — don't fail if these error
  try {
    const uncommitted = gitRun(repoPath, 'diff', '--name-only', 'HEAD');
    const staged = gitRun(repoPath, 'diff', '--name-only', '--cached');
    for (const output of [uncommitted, staged]) {
      for (const f of output.split('\n').filter(f => f.trim())) {
        branchFiles.add(f);
      }
    }
  } catch {
    // working-tree/staged lookup failed — continue with committed files only
  }

  if (branchFiles.size === 0) return '';

  return gitRun(repoPath, 'diff', mergeBase, '--', ...Array.from(branchFiles).sort());
}

export function getSelectedCommitsDiff(repoPath: string, shas: string[]): string {
  return shas
    .map(sha => gitRun(repoPath, 'diff-tree', '-p', '--no-commit-id', sha))
    .join('\n');
}

interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export function getBranchCommits(repoPath: string, baseBranch: string): Commit[] {
  let output = gitRun(
    repoPath,
    'log', '--first-parent', '--no-merges',
    '--format=%H|%s|%an|%ar',
    `${baseBranch}..HEAD`,
  );

  // On main (or when range is empty), show recent commits
  if (!output.trim()) {
    output = gitRun(
      repoPath,
      'log', '--first-parent', '--no-merges',
      '--format=%H|%s|%an|%ar',
      '-20', 'HEAD',
    );
  }

  const commits: Commit[] = [];
  for (const line of output.split('\n')) {
    if (!line.includes('|')) continue;
    const parts = line.split('|', 4);
    if (parts.length < 4) continue;
    commits.push({
      sha: parts[0],
      message: parts[1],
      author: parts[2],
      date: parts[3],
    });
  }
  return commits;
}

export interface RepoMeta {
  branch: string;
  baseBranch: string;
  repoPath: string;
  repoName: string;
  pr?: { url: string; number: number; title: string };
}

export function getRepoMeta(repoPath: string, baseBranch: string): RepoMeta {
  const branch = gitRun(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD');
  const meta: RepoMeta = {
    branch,
    baseBranch,
    repoPath,
    repoName: basename(repoPath),
  };
  try {
    // gh is optional — not a git command, so call execFileSync directly
    const result = execFileSync('gh', ['pr', 'view', '--json', 'url,number,title'], {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    meta.pr = JSON.parse(result);
  } catch {
    // gh not installed or no PR
  }
  return meta;
}

export interface FileLine {
  num: number;
  content: string;
}

export function getFileLines(
  repoPath: string,
  filepath: string,
  start: number,
  count: number,
  direction: string = 'down',
): FileLine[] {
  const fullPath = join(repoPath, filepath);
  if (!existsSync(fullPath)) return [];
  const lines = readFileSync(fullPath, 'utf-8').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  if (direction === 'up') {
    const end = Math.max(start - 1, 0);
    const begin = Math.max(end - count, 0);
    return Array.from({ length: end - begin }, (_, i) => ({
      num: begin + i + 1,
      content: lines[begin + i],
    }));
  } else {
    const begin = start;
    const end = Math.min(begin + count, lines.length);
    return Array.from({ length: end - begin }, (_, i) => ({
      num: begin + i + 1,
      content: lines[begin + i],
    }));
  }
}
