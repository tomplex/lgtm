import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import { initStore, closeStore } from '../store.js';
import { SessionManager } from '../session-manager.js';
import { createApp } from '../app.js';
import { mountMcp, _testing_getDiffClaimHolder } from '../mcp.js';
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

  it('start tool no longer exists', async () => {
    const c = await createMcpClient(app);
    try {
      const res = await c.callTool('start', { repoPath: fixture.repoPath });
      // MCP SDK returns a JSON-RPC error for unknown tools; some SDK versions
      // return a result with an error field, others set isError on the result.
      // Accept any of these forms.
      const raw = res.raw as { result?: { isError?: boolean } } | null;
      const hasError = Boolean(res.error)
        || (res.json && typeof res.json === 'object' && 'error' in (res.json as object))
        || Boolean(raw?.result?.isError);
      expect(hasError).toBe(true);
    } finally {
      await c.close();
    }
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

  describe('auto-claim', () => {
    let claimFixture: GitFixture;

    beforeAll(() => {
      claimFixture = createGitFixture();
    });

    afterAll(() => {
      claimFixture.cleanup();
    });

    it('first comment auto-claims diff reviews for the calling session', async () => {
      const clientA = await createMcpClient(app);
      try {
        await clientA.callTool('comment', {
          repoPath: claimFixture.repoPath,
          comments: [{ file: 'src/app.ts', line: 1, comment: 'x' }],
        });
        const slug = manager.findByRepoPath(claimFixture.repoPath)!.slug;
        expect(_testing_getDiffClaimHolder(slug)).toBe(clientA.sessionId);
      } finally {
        await clientA.close();
      }
    });

    it('second session does not steal the claim', async () => {
      const clientA = await createMcpClient(app);
      const clientB = await createMcpClient(app);
      try {
        await clientA.callTool('comment', {
          repoPath: claimFixture.repoPath,
          comments: [{ file: 'src/app.ts', line: 1, comment: 'a' }],
        });
        const slug = manager.findByRepoPath(claimFixture.repoPath)!.slug;
        const firstHolder = _testing_getDiffClaimHolder(slug);

        await clientB.callTool('comment', {
          repoPath: claimFixture.repoPath,
          comments: [{ file: 'src/app.ts', line: 2, comment: 'b' }],
        });

        expect(_testing_getDiffClaimHolder(slug)).toBe(firstHolder);
        expect(firstHolder).toBe(clientA.sessionId);
      } finally {
        await clientA.close();
        await clientB.close();
      }
    });
  });

  describe('claim_reviews', () => {
    let crFixture: GitFixture;

    beforeAll(() => {
      crFixture = createGitFixture();
    });

    afterAll(() => {
      crFixture.cleanup();
    });

    it('returns slug and url', async () => {
      const c = await createMcpClient(app);
      try {
        const res = await c.callTool('claim_reviews', { repoPath: crFixture.repoPath });
        expect(res.json).toMatchObject({ slug: expect.any(String), url: expect.stringContaining('/project/') });
      } finally {
        await c.close();
      }
    });

    it('takes the claim unconditionally when another session holds it', async () => {
      const clientA = await createMcpClient(app);
      const clientB = await createMcpClient(app);
      try {
        await clientA.callTool('comment', {
          repoPath: crFixture.repoPath,
          comments: [{ file: 'src/app.ts', line: 1, comment: 'a' }],
        });
        const slug = manager.findByRepoPath(crFixture.repoPath)!.slug;
        expect(_testing_getDiffClaimHolder(slug)).toBe(clientA.sessionId);

        await clientB.callTool('claim_reviews', { repoPath: crFixture.repoPath });
        expect(_testing_getDiffClaimHolder(slug)).toBe(clientB.sessionId);
      } finally {
        await clientA.close();
        await clientB.close();
      }
    });

    it('sets description on a fresh repo', async () => {
      const c = await createMcpClient(app);
      const freshFixture = createGitFixture();
      try {
        await c.callTool('claim_reviews', {
          repoPath: freshFixture.repoPath,
          description: 'review banner',
        });
        const found = manager.findByRepoPath(freshFixture.repoPath)!;
        expect(found.session.description).toBe('review banner');
      } finally {
        await c.close();
        freshFixture.cleanup();
      }
    });

    it('updates description on an already-registered repo', async () => {
      const c = await createMcpClient(app);
      const freshFixture = createGitFixture();
      try {
        manager.register(freshFixture.repoPath, { description: 'original' });
        await c.callTool('claim_reviews', {
          repoPath: freshFixture.repoPath,
          description: 'updated',
        });
        const found = manager.findByRepoPath(freshFixture.repoPath)!;
        expect(found.session.description).toBe('updated');
      } finally {
        await c.close();
        freshFixture.cleanup();
      }
    });
  });

  describe('set_walkthrough', () => {
    it('parses markdown and stores on session', async () => {
      const mdPath = join(tmpDir, 'walkthrough.md');
      writeFileSync(mdPath, `## Summary

Test.

## Stop 1

- importance: primary
- title: Test stop

A short narrative.

### Artifact: a.ts

- hunk: 1-5
`);

      const res = await client.callTool('set_walkthrough', {
        repoPath: fixture.repoPath,
        walkthroughPath: mdPath,
      });
      expect(res.error).toBeUndefined();
      const body = res.json as { ok?: boolean; stopCount?: number; diffHash?: string; error?: string };
      expect(body.ok).toBe(true);
      expect(body.stopCount).toBe(1);
      expect(body.diffHash).toMatch(/^[a-f0-9]{64}$/);

      const session = manager.findByRepoPath(fixture.repoPath)!.session;
      expect(session.walkthrough).not.toBeNull();
      expect(session.walkthrough!.stops[0].title).toBe('Test stop');
      expect(session.walkthrough!.diffHash).toMatch(/^[a-f0-9]{64}$/);
      expect(session.walkthrough!.generatedAt).toMatch(/^\d{4}-/);
    });

    it('returns error on malformed input', async () => {
      const mdPath = join(tmpDir, 'bad.md');
      writeFileSync(mdPath, 'not valid');
      const res = await client.callTool('set_walkthrough', {
        repoPath: fixture.repoPath,
        walkthroughPath: mdPath,
      });
      const body = res.json as { error?: string; ok?: boolean };
      expect(body.error).toBeDefined();
    });
  });

  describe('stop', () => {
    it('returns an error when the repo is not registered', async () => {
      const c = await createMcpClient(app);
      const freshFixture = createGitFixture();
      try {
        const res = await c.callTool('stop', { repoPath: freshFixture.repoPath });
        expect(res.json).toMatchObject({ error: 'No active review session for this repo path.' });
      } finally {
        await c.close();
        freshFixture.cleanup();
      }
    });
  });
});
