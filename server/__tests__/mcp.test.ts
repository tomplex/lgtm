import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import { initStore, closeStore } from '../store.js';
import { SessionManager } from '../session-manager.js';
import { createApp } from '../app.js';
import { mountMcp } from '../mcp.js';
import { createMcpClient, type McpClient } from './helpers/mcp-client.js';

describe('mcp', () => {
  let fixture: GitFixture;
  let tmpDir: string;
  let app: ReturnType<typeof createApp>;
  let manager: SessionManager;
  let client: McpClient;

  beforeAll(async () => {
    fixture = createGitFixture();
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-mcp-test-'));
    initStore(join(tmpDir, 'test.db'));
    manager = new SessionManager(9999);
    app = createApp(manager);
    mountMcp(app, manager);
    client = await createMcpClient(app);
  });

  afterAll(async () => {
    await client.close();
    for (const project of manager.list()) manager.deregister(project.slug);
    closeStore();
    fixture.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('harness can call a tool', async () => {
    // claim_reviews exists today and is safe to call — it registers if needed.
    // Using it here is a smoke test that the harness wiring works. We only
    // assert that the call succeeded (no JSON-RPC error, a payload came back);
    // the response shape is validated explicitly in later tasks.
    const res = await client.callTool('claim_reviews', { repoPath: fixture.repoPath });
    expect(res.error).toBeUndefined();
    expect(res.json).toBeDefined();
  });

  describe('auto-init', () => {
    let autoInitFixture: GitFixture;

    beforeAll(() => {
      autoInitFixture = createGitFixture();
    });

    afterAll(() => {
      autoInitFixture.cleanup();
    });

    it('comment on an unregistered repo auto-registers the project', async () => {
      const local = await createMcpClient(app);
      try {
        expect(manager.findByRepoPath(autoInitFixture.repoPath)).toBeUndefined();

        const res = await local.callTool('comment', {
          repoPath: autoInitFixture.repoPath,
          comments: [{ file: 'src/app.ts', line: 1, comment: 'hi' }],
        });

        expect(res.json).toMatchObject({ ok: true });
        expect(manager.findByRepoPath(autoInitFixture.repoPath)).toBeDefined();
      } finally {
        await local.close();
      }
    });
  });
});
