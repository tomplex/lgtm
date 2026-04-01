import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

function gitRun(repoPath: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    }).trim();
  } catch {
    return '';
  }
}

export function detectBaseBranch(repoPath: string): string {
  for (const candidate of ['master', 'main']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', candidate], {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return candidate;
    } catch {
      continue;
    }
  }
  return 'master';
}

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

  const uncommitted = gitRun(repoPath, 'diff', '--name-only', 'HEAD');
  const staged = gitRun(repoPath, 'diff', '--name-only', '--cached');
  for (const output of [uncommitted, staged]) {
    for (const f of output.split('\n').filter(f => f.trim())) {
      branchFiles.add(f);
    }
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

interface DiffManifestEntry {
  path: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export function getDiffManifest(repoPath: string, baseBranch: string): DiffManifestEntry[] {
  const mergeBase = gitRun(repoPath, 'merge-base', baseBranch, 'HEAD');
  if (!mergeBase) return [];

  // Get additions/deletions per file
  const numstat = gitRun(repoPath, 'diff', '--numstat', mergeBase, 'HEAD');
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue;
    const [add, del, ...pathParts] = line.split('\t');
    const filePath = pathParts.join('\t'); // handles renames with => in path
    stats.set(filePath, {
      additions: add === '-' ? 0 : parseInt(add),
      deletions: del === '-' ? 0 : parseInt(del),
    });
  }

  // Get change types per file
  const nameStatus = gitRun(repoPath, 'diff', '--name-status', mergeBase, 'HEAD');
  const manifest: DiffManifestEntry[] = [];
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const statusChar = parts[0][0];
    // For renames, parts[2] is the new path; otherwise parts[1]
    const filePath = statusChar === 'R' ? parts[2] : parts[1];
    const changeType: DiffManifestEntry['changeType'] =
      statusChar === 'A' ? 'added' :
      statusChar === 'D' ? 'deleted' :
      statusChar === 'R' ? 'renamed' : 'modified';

    const numstatKey = statusChar === 'R' ? `${parts[1]} => ${parts[2]}` : filePath;
    const fileStat = stats.get(numstatKey) ?? stats.get(filePath) ?? { additions: 0, deletions: 0 };

    manifest.push({
      path: filePath,
      changeType,
      additions: fileStat.additions,
      deletions: fileStat.deletions,
    });
  }
  return manifest;
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
