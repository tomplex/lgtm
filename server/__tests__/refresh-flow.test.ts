import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { initStore, closeStore } from '../store.js';
import { SessionManager } from '../session-manager.js';
import { createApp } from '../app.js';
import { mountMcp } from '../mcp.js';
import { createMcpClient } from './helpers/mcp-client.js';

describe('refresh flow (end-to-end)', () => {
  let tmpDir: string;
  let scratchDir: string;
  let repo: string;
  let app: ReturnType<typeof createApp>;
  let manager: SessionManager;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-refresh-flow-test-'));
    scratchDir = mkdtempSync(join(tmpdir(), 'lgtm-refresh-flow-scratch-'));
    initStore(join(tmpDir, 'test.db'));
    manager = new SessionManager(9999);
    app = createApp(manager);
    mountMcp(app, manager);

    repo = mkdtempSync(join(tmpdir(), 'lgtm-refresh-flow-repo-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(join(repo, 'a.ts'), 'a base\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(join(repo, 'a.ts'), 'a feature v1\n');
    writeFileSync(join(repo, 'b.ts'), 'b feature\n');
    git('add', '.');
    git('commit', '-q', '-m', 'feature work');
  });

  afterAll(() => {
    for (const project of manager.list()) manager.deregister(project.slug);
    closeStore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(scratchDir, { recursive: true, force: true });
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeMd(name: string, content: string): string {
    const p = join(scratchDir, name);
    writeFileSync(p, content);
    return p;
  }

  function gitInRepo(...args: string[]): string {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf-8' }).trim();
  }

  it('partial merge preserves untouched entries', async () => {
    const c = await createMcpClient(app);
    try {
      const filesAll = writeMd('files-all.md',
        `## a.ts\n- priority: critical\n- phase: review\n- category: core\n\nA original.\n\n## b.ts\n- priority: low\n- phase: skim\n- category: test\n\nB original.\n`,
      );
      const synth = writeMd('synth-1.md',
        `## Overview\nOver\n\n## Review Strategy\nStrat\n\n## Groups\n### Core\n- a.ts\n- b.ts\n`,
      );
      const r1 = await c.callTool('set_analysis', { repoPath: repo, fileAnalysisPath: filesAll, synthesisPath: synth });
      expect(r1.error).toBeUndefined();

      writeFileSync(join(repo, 'a.ts'), 'a feature v2\n');
      gitInRepo('add', '.');
      gitInRepo('commit', '-q', '-m', 'tweak a');

      const readRes = await c.callTool('read_analysis', { repoPath: repo });
      expect(readRes.error).toBeUndefined();
      const payload = readRes.json as { freshness: { staleFiles: string[] } | null };
      expect(payload.freshness).not.toBeNull();
      expect(payload.freshness!.staleFiles).toContain('a.ts');
      expect(payload.freshness!.staleFiles).not.toContain('b.ts');

      const filesDelta = writeMd('files-delta.md',
        `## a.ts\n- priority: critical\n- phase: review\n- category: core\n\nA UPDATED.\n`,
      );
      const synth2 = writeMd('synth-2.md',
        `## Overview\nOver2\n\n## Review Strategy\nStrat2\n\n## Groups\n### Core\n- a.ts\n- b.ts\n`,
      );
      const r2 = await c.callTool('set_analysis', {
        repoPath: repo, fileAnalysisPath: filesDelta, synthesisPath: synth2, mode: 'merge',
      });
      expect(r2.error).toBeUndefined();

      const final = await c.callTool('read_analysis', { repoPath: repo });
      const stored = (final.json as { json: { files: Record<string, { summary: string; priority: string }> } }).json;
      expect(Object.keys(stored.files).sort()).toEqual(['a.ts', 'b.ts']);
      expect(stored.files['a.ts'].summary).toBe('A UPDATED.');
      expect(stored.files['b.ts'].summary).toBe('B original.');
    } finally {
      await c.close();
    }
  });

  it('removedFiles drops entries after merge', async () => {
    const c = await createMcpClient(app);
    try {
      const filesAll = writeMd('files-all-2.md',
        `## a.ts\n- priority: critical\n- phase: review\n- category: core\n\nA reseed.\n\n## b.ts\n- priority: low\n- phase: skim\n- category: test\n\nB reseed.\n`,
      );
      const synth = writeMd('synth-reseed.md',
        `## Overview\nO\n\n## Review Strategy\nS\n\n## Groups\n### Core\n- a.ts\n- b.ts\n`,
      );
      await c.callTool('set_analysis', { repoPath: repo, fileAnalysisPath: filesAll, synthesisPath: synth });

      unlinkSync(join(repo, 'b.ts'));
      gitInRepo('add', '-A');
      gitInRepo('commit', '-q', '-m', 'drop b');

      const readRes = await c.callTool('read_analysis', { repoPath: repo });
      const payload = readRes.json as { freshness: { removedFiles: string[] } };
      expect(payload.freshness.removedFiles).toContain('b.ts');

      const filesEmpty = writeMd('files-empty.md', '');
      const synth2 = writeMd('synth-final.md', `## Overview\nO\n\n## Review Strategy\nS\n\n## Groups\n`);
      const r = await c.callTool('set_analysis', {
        repoPath: repo, fileAnalysisPath: filesEmpty, synthesisPath: synth2,
        mode: 'merge', removedFiles: ['b.ts'],
      });
      expect(r.error).toBeUndefined();

      const final = await c.callTool('read_analysis', { repoPath: repo });
      const stored = (final.json as { json: { files: Record<string, unknown> } }).json;
      expect(Object.keys(stored.files)).toEqual(['a.ts']);
    } finally {
      await c.close();
    }
  });
});
