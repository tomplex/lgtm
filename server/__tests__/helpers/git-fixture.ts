import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

export interface GitFixture {
  repoPath: string;
  mainBranch: string;
  featureBranch: string;
  /** SHAs of commits on the feature branch (oldest first) */
  featureCommits: string[];
  cleanup: () => void;
}

function git(repoPath: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repoPath, encoding: 'utf-8' }).trim();
}

/**
 * Creates a temp git repo with:
 * - main branch with 2 commits (README.md, src/app.ts, package.json)
 * - feature branch with 2 commits (modifies src/app.ts, adds src/utils.ts)
 * - feature branch checked out
 */
export function createGitFixture(): GitFixture {
  const repoPath = mkdtempSync(join(tmpdir(), 'lgtm-test-'));

  // Init and configure
  git(repoPath, 'init', '-b', 'main');
  git(repoPath, 'config', 'user.name', 'Test User');
  git(repoPath, 'config', 'user.email', 'test@example.com');

  // Main branch — commit 1
  writeFileSync(join(repoPath, 'README.md'), '# Test Project\n\nA test repo.\n');
  mkdirSync(join(repoPath, 'src'));
  writeFileSync(join(repoPath, 'src', 'app.ts'), [
    'import { hello } from "./utils";',
    '',
    'function main() {',
    '  console.log(hello());',
    '}',
    '',
    'main();',
    '',
  ].join('\n'));
  writeFileSync(join(repoPath, 'package.json'), '{ "name": "test-project" }\n');
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-m', 'initial commit');

  // Main branch — commit 2
  writeFileSync(join(repoPath, 'README.md'), '# Test Project\n\nA test repo for LGTM.\n');
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-m', 'update readme');

  // Feature branch
  git(repoPath, 'checkout', '-b', 'feature');

  // Feature commit 1 — modify app.ts
  writeFileSync(join(repoPath, 'src', 'app.ts'), [
    'import { hello, goodbye } from "./utils";',
    '',
    'function main() {',
    '  console.log(hello());',
    '  console.log(goodbye());',
    '}',
    '',
    'main();',
    '',
  ].join('\n'));
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-m', 'add goodbye call');
  const sha1 = git(repoPath, 'rev-parse', 'HEAD');

  // Feature commit 2 — add utils.ts
  writeFileSync(join(repoPath, 'src', 'utils.ts'), [
    'export function hello(): string {',
    '  return "hello";',
    '}',
    '',
    'export function goodbye(): string {',
    '  return "goodbye";',
    '}',
    '',
  ].join('\n'));
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-m', 'add utils module');
  const sha2 = git(repoPath, 'rev-parse', 'HEAD');

  return {
    repoPath,
    mainBranch: 'main',
    featureBranch: 'feature',
    featureCommits: [sha1, sha2],
    cleanup: () => rmSync(repoPath, { recursive: true, force: true }),
  };
}
