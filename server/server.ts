#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import open from 'open';
import { createApp } from './app.js';
import { SessionManager } from './session-manager.js';

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

  const port = args.port ? parseInt(args.port) : 9900;

  mkdirSync('/tmp/claude-review', { recursive: true });

  const manager = new SessionManager(port);
  const app = createApp(manager);
  const url = `http://127.0.0.1:${port}`;

  app.listen(port, '127.0.0.1', () => {
    console.log(`REVIEW_URL=${url}`);
    console.log(`REVIEW_PID=${process.pid}`);
    open(url);
  });
}

main();
