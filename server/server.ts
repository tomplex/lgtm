#!/usr/bin/env node

import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import open from 'open';
import { createApp } from './app.js';
import { SessionManager } from './session-manager.js';
import { mountMcp } from './mcp.js';

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

  const manager = new SessionManager(port);
  const app = createApp(manager);
  mountMcp(app, manager);
  const url = `http://127.0.0.1:${port}`;

  app.listen(port, '127.0.0.1', () => {
    console.log(`LGTM_URL=${url}`);
    console.log(`LGTM_PID=${process.pid}`);

    // Convenience: --repo auto-registers a project and opens the browser
    if (args.repo) {
      const repoPath = resolve(args.repo);
      const result = manager.register(repoPath, {
        description: args.description || '',
        baseBranch: args.base || undefined,
      });
      console.log(`PROJECT_REGISTERED=${result.slug}`);
      console.log(`REVIEW_URL=${result.url}`);
      const lockFile = `/tmp/lgtm-opened-${port}`;
      if (!existsSync(lockFile)) {
        writeFileSync(lockFile, String(process.pid));
        open(result.url);
      }
    }
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`SHUTDOWN signal=${signal}`);
    try { await manager.shutdownAll(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
}

main();
