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

  describe('read_analysis', () => {
    it('returns null json + empty markdown + null freshness when no analysis is set', async () => {
      // Use a fresh fixture so we don't pick up state from earlier tests.
      const f = createGitFixture();
      try {
        const c = await createMcpClient(app);
        try {
          const res = await c.callTool('read_analysis', { repoPath: f.repoPath });
          expect(res.error).toBeUndefined();
          expect(res.json).toBeDefined();
          expect((res.json as { json: unknown }).json).toBeNull();
          expect((res.json as { markdown: string }).markdown).toBe('');
          expect((res.json as { freshness: unknown }).freshness).toBeNull();
        } finally {
          await c.close();
        }
      } finally {
        f.cleanup();
      }
    });

    it('returns json + markdown + freshness when analysis is set', async () => {
      const f = createGitFixture();
      try {
        // Register and seed an analysis directly via the manager.
        const reg = manager.register(f.repoPath);
        const session = manager.get(reg.slug)!;
        const blobMap = session.getCurrentBlobMap();
        const paths = Object.keys(blobMap.blobsByPath);
        const path = paths[0] ?? 'placeholder.ts';

        session.setAnalysis({
          overview: 'o', reviewStrategy: 's',
          files: {
            [path]: { priority: 'critical', phase: 'review', summary: 'multi line\nsummary content', category: 'core' },
          },
          groups: [],
          synthesizedAtFileSet: [path],
        });

        const c = await createMcpClient(app);
        try {
          const res = await c.callTool('read_analysis', { repoPath: f.repoPath });
          expect(res.error).toBeUndefined();
          const payload = res.json as { json: Record<string, unknown> | null; markdown: string; freshness: { staleFiles: string[] } | null };
          expect(payload.json).not.toBeNull();
          expect(payload.markdown).toMatch(new RegExp(`^## ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'));
          expect(payload.markdown).toMatch(/- priority: critical/);
          expect(payload.markdown).toMatch(/- phase: review/);
          expect(payload.markdown).toMatch(/- category: core/);
          expect(payload.freshness).not.toBeNull();
          expect(Array.isArray(payload.freshness!.staleFiles)).toBe(true);
        } finally {
          await c.close();
        }
      } finally {
        f.cleanup();
      }
    });
  });

  describe('project claims', () => {
    it('getProjectClaim returns null before any claim', async () => {
      const f = createGitFixture();
      try {
        // Register the project but do not call claim_reviews.
        const reg = manager.register(f.repoPath);
        // Import is at the top of the test file in implementation step.
        const { getProjectClaim } = await import('../mcp.js');
        expect(getProjectClaim(reg.slug)).toBeNull();
      } finally {
        f.cleanup();
      }
    });

    it('claim_reviews populates getProjectClaim', async () => {
      const f = createGitFixture();
      try {
        const c = await createMcpClient(app);
        try {
          const res = await c.callTool('claim_reviews', { repoPath: f.repoPath });
          expect(res.error).toBeUndefined();
          const slug = (res.json as { slug: string }).slug;
          const { getProjectClaim, isClaimAlive } = await import('../mcp.js');
          const claim = getProjectClaim(slug);
          expect(claim).not.toBeNull();
          expect(claim!.slug).toBe(slug);
          expect(typeof claim!.sessionId).toBe('string');
          expect(claim!.sessionId.length).toBeGreaterThan(0);
          expect(typeof claim!.claimedAt).toBe('string');
          expect(isClaimAlive(slug)).toBe(true);
        } finally {
          await c.close();
        }
      } finally {
        f.cleanup();
      }
    });

    it('isClaimAlive returns false after the MCP transport closes', async () => {
      const f = createGitFixture();
      try {
        const c = await createMcpClient(app);
        const res = await c.callTool('claim_reviews', { repoPath: f.repoPath });
        const slug = (res.json as { slug: string }).slug;
        const { getProjectClaim, isClaimAlive } = await import('../mcp.js');
        expect(isClaimAlive(slug)).toBe(true);
        // Close the MCP client, triggering transport.onclose.
        await c.close();
        // Give the transport a tick to process the close event.
        await new Promise((r) => setTimeout(r, 50));
        // After cleanup, the claim should be removed entirely (cleared by clearProjectClaimsForSession).
        expect(getProjectClaim(slug)).toBeNull();
        expect(isClaimAlive(slug)).toBe(false);
      } finally {
        f.cleanup();
      }
    });
  });

  describe('set_analysis modes', () => {
    it('mode=replace stamps blob SHAs on entries and broadcasts analysis_changed', async () => {
      const f = createGitFixture();
      try {
        const reg = manager.register(f.repoPath);
        const session = manager.get(reg.slug)!;
        const blobMap = session.getCurrentBlobMap();
        const paths = Object.keys(blobMap.blobsByPath);
        if (paths.length === 0) return; // fixture has no diff, nothing to assert
        const path = paths[0];

        // Track broadcast events.
        const events: string[] = [];
        const orig = session.broadcast.bind(session);
        session.broadcast = (event: string, data: unknown) => { events.push(event); orig(event, data); };

        // Write the agent-style markdown files.
        const filesMd = join(tmpDir, 'set-replace-files.md');
        writeFileSync(filesMd, `## ${path}\n- priority: critical\n- phase: review\n- category: core\n\nReplace test summary.\n`);
        const synthMd = join(tmpDir, 'set-replace-synth.md');
        writeFileSync(synthMd, `## Overview\nO\n\n## Review Strategy\nS\n\n## Opinion\nP\n\n## Groups\n### Core\n- ${path}\n`);

        const c = await createMcpClient(app);
        try {
          const res = await c.callTool('set_analysis', {
            repoPath: f.repoPath,
            fileAnalysisPath: filesMd,
            synthesisPath: synthMd,
          });
          expect(res.error).toBeUndefined();
          const stored = (session.analysis as { files: Record<string, { analyzedAtBaseBlob?: string; analyzedAtHeadBlob?: string }>; synthesizedAtFileSet?: string[] });
          expect(stored.files[path].analyzedAtBaseBlob).toBe(blobMap.blobsByPath[path].oldBlob);
          expect(stored.files[path].analyzedAtHeadBlob).toBe(blobMap.blobsByPath[path].newBlob);
          expect(stored.synthesizedAtFileSet).toEqual([path]);
          expect(events).toContain('analysis_changed');
        } finally {
          await c.close();
        }
      } finally {
        f.cleanup();
      }
    });

    it('mode=merge preserves entries not in the new payload', async () => {
      const f = createGitFixture();
      try {
        const reg = manager.register(f.repoPath);
        const session = manager.get(reg.slug)!;
        const blobMap = session.getCurrentBlobMap();
        const paths = Object.keys(blobMap.blobsByPath);
        if (paths.length < 1) return;
        const path = paths[0];

        // First: replace with both a real path and a synthetic 'b.ts' entry that isn't in the diff.
        // The synthetic entry will have empty blobs but exists in the analysis.
        session.setAnalysis({
          overview: 'o', reviewStrategy: 's',
          files: {
            [path]: { priority: 'normal', phase: 'review', summary: 'orig', category: 'core', analyzedAtBaseBlob: blobMap.blobsByPath[path].oldBlob, analyzedAtHeadBlob: blobMap.blobsByPath[path].newBlob },
            'b.ts': { priority: 'low', phase: 'skim', summary: 'b summary', category: 'test' },
          },
          groups: [],
          synthesizedAtFileSet: [path, 'b.ts'].sort(),
        });

        // Merge with only the real path having an updated summary.
        const filesMd = join(tmpDir, 'merge-files.md');
        writeFileSync(filesMd, `## ${path}\n- priority: critical\n- phase: review\n- category: core\n\nUpdated summary.\n`);
        const synthMd = join(tmpDir, 'merge-synth.md');
        writeFileSync(synthMd, `## Overview\nNewO\n\n## Review Strategy\nNewS\n\n## Groups\n### Core\n- ${path}\n`);

        const c = await createMcpClient(app);
        try {
          const res = await c.callTool('set_analysis', {
            repoPath: f.repoPath,
            fileAnalysisPath: filesMd,
            synthesisPath: synthMd,
            mode: 'merge',
          });
          expect(res.error).toBeUndefined();
          const stored = (session.analysis as { files: Record<string, { summary: string; priority: string }> });
          expect(Object.keys(stored.files).sort()).toEqual([path, 'b.ts'].sort());
          expect(stored.files[path].summary).toBe('Updated summary.');
          expect(stored.files[path].priority).toBe('critical');
          expect(stored.files['b.ts'].summary).toBe('b summary'); // preserved
        } finally {
          await c.close();
        }
      } finally {
        f.cleanup();
      }
    });

    it('mode=merge with removedFiles drops listed entries', async () => {
      const f = createGitFixture();
      try {
        const reg = manager.register(f.repoPath);
        const session = manager.get(reg.slug)!;
        const blobMap = session.getCurrentBlobMap();
        const paths = Object.keys(blobMap.blobsByPath);
        if (paths.length < 1) return;
        const path = paths[0];

        session.setAnalysis({
          overview: 'o', reviewStrategy: 's',
          files: {
            [path]: { priority: 'normal', phase: 'review', summary: 'a', category: 'core' },
            'gone.ts': { priority: 'low', phase: 'skim', summary: 'g', category: 'old' },
          },
          groups: [],
          synthesizedAtFileSet: [path, 'gone.ts'],
        });

        // Merge with empty file analysis but explicit removal.
        const filesMd = join(tmpDir, 'remove-files.md');
        writeFileSync(filesMd, ``);
        const synthMd = join(tmpDir, 'remove-synth.md');
        writeFileSync(synthMd, `## Overview\nO\n\n## Review Strategy\nS\n\n## Groups\n`);

        const c = await createMcpClient(app);
        try {
          const res = await c.callTool('set_analysis', {
            repoPath: f.repoPath,
            fileAnalysisPath: filesMd,
            synthesisPath: synthMd,
            mode: 'merge',
            removedFiles: ['gone.ts'],
          });
          expect(res.error).toBeUndefined();
          const stored = (session.analysis as { files: Record<string, unknown> });
          expect(Object.keys(stored.files)).toEqual([path]);
        } finally {
          await c.close();
        }
      } finally {
        f.cleanup();
      }
    });
  });
});
