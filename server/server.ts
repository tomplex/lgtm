#!/usr/bin/env node

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import open from 'open';
import { detectBaseBranch, gitRun } from './git-ops.js';
import { Session } from './session.js';
import { createApp } from './app.js';

function stablePortForPath(path: string): number {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h += path.charCodeAt(i) * (i + 1);
  }
  return 9850 + (h % 100);
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2);
      args[key] = argv[++i];
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv);

  const repoPath = resolve(args.repo || process.cwd());
  const baseBranch = args.base || detectBaseBranch(repoPath);
  const port = args.port ? parseInt(args.port) : stablePortForPath(repoPath);
  const description = args.description || '';

  const reviewDir = '/tmp/claude-review';
  mkdirSync(reviewDir, { recursive: true });

  let outputPath: string;
  if (args.output) {
    outputPath = args.output;
  } else {
    const branch = gitRun(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD');
    const slug = branch ? branch.replace(/\//g, '-') : repoPath.split('/').pop()!;
    outputPath = `${reviewDir}/${slug}.md`;
  }

  writeFileSync(outputPath, '');

  const session = new Session({
    repoPath,
    baseBranch,
    description,
    outputPath,
  });

  const app = createApp(session);
  const url = `http://127.0.0.1:${port}`;

  app.listen(port, '127.0.0.1', () => {
    console.log(`REVIEW_URL=${url}`);
    console.log(`REVIEW_OUTPUT=${outputPath}`);
    console.log(`REVIEW_PID=${process.pid}`);
    open(url);
  });
}

main();
