import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import { initStore, closeStore } from '../store.js';
import { SessionManager } from '../session-manager.js';
import { createApp } from '../app.js';

describe('routes', () => {
  let fixture: GitFixture;
  let tmpDir: string;
  let app: ReturnType<typeof createApp>;
  let manager: SessionManager;
  let slug: string;

  beforeAll(() => {
    fixture = createGitFixture();
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-routes-test-'));
    initStore(join(tmpDir, 'test.db'));
    manager = new SessionManager(9999);
    app = createApp(manager);

    // Register the test project
    const result = manager.register(fixture.repoPath);
    slug = result.slug;
  });

  afterAll(() => {
    // Deregister all sessions to stop setInterval timers from watchRepo()
    for (const project of manager.list()) {
      manager.deregister(project.slug);
    }
    closeStore();
    fixture.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('project management', () => {
    it('POST /projects registers a project', async () => {
      const res = await request(app)
        .post('/projects')
        .send({ repoPath: fixture.repoPath })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.slug).toBe(slug); // Already registered, returns existing
    });

    it('POST /projects returns 400 without repoPath', async () => {
      const res = await request(app)
        .post('/projects')
        .send({})
        .expect(400);
      expect(res.body.error).toContain('repoPath');
    });

    it('GET /projects lists registered projects', async () => {
      const res = await request(app)
        .get('/projects')
        .expect(200);
      expect(res.body.projects).toBeInstanceOf(Array);
      expect(res.body.projects.some((p: { slug: string }) => p.slug === slug)).toBe(true);
    });

    it('GET /projects returns enriched fields for a fresh project', async () => {
      const res = await request(app)
        .get('/projects')
        .expect(200);
      const project = res.body.projects.find((p: { slug: string }) => p.slug === slug);
      expect(project).toBeDefined();
      expect(project.repoName).toBe(basename(fixture.repoPath));
      expect(project.branch).toBe('feature');
      expect(project.baseBranch).toBe('main');
      expect(project.pr).toBeNull();
      expect(project.claudeCommentCount).toBe(0);
      expect(project.userCommentCount).toBe(0);
    });

    it('GET /projects counts include active+resolved, exclude dismissed and replies', async () => {
      // Set up four comments in a known state
      const mk = async (body: object) => {
        const r = await request(app).post(`/project/${slug}/comments`).send(body).expect(200);
        return r.body.comment.id;
      };
      const a1 = await mk({ author: 'user', text: 'active user', item: 'diff' });
      const a2 = await mk({ author: 'user', text: 'will resolve', item: 'diff' });
      const a3 = await mk({ author: 'user', text: 'will dismiss', item: 'diff' });
      const a4 = await mk({ author: 'claude', text: 'claude top', item: 'diff' });
      const r1 = await mk({ author: 'user', text: 'reply', item: 'diff', parentId: a1 });

      await request(app).patch(`/project/${slug}/comments/${a2}`).send({ status: 'resolved' }).expect(200);
      await request(app).patch(`/project/${slug}/comments/${a3}`).send({ status: 'dismissed' }).expect(200);

      const res = await request(app).get('/projects').expect(200);
      const project = res.body.projects.find((p: { slug: string }) => p.slug === slug);
      // userCommentCount: a1 active → counted; a2 resolved and a3 dismissed → excluded; reply → excluded. Count = 1.
      expect(project.userCommentCount).toBe(1);
      expect(project.claudeCommentCount).toBe(1);

      // Cleanup so later tests in the file see the original state.
      // Delete reply first so its parent still exists when it's removed.
      for (const id of [r1, a1, a2, a3, a4]) {
        await request(app).delete(`/project/${slug}/comments/${id}`).expect(200);
      }
    });

    it('GET /projects returns branch:null when the repo directory is missing', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'lgtm-gone-'));
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: tmp });
        execFileSync('git', ['config', 'user.email', 'x@y.z'], { cwd: tmp });
        execFileSync('git', ['config', 'user.name', 'x'], { cwd: tmp });
        execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: tmp });

        const reg = await request(app).post('/projects').send({ repoPath: tmp }).expect(200);
        const goneSlug = reg.body.slug;

        // Remove the directory out from under the session
        rmSync(tmp, { recursive: true, force: true });

        const res = await request(app).get('/projects').expect(200);
        const gone = res.body.projects.find((p: { slug: string }) => p.slug === goneSlug);
        expect(gone).toBeDefined();
        expect(gone.branch).toBeNull();
        expect(gone.pr).toBeNull();
        // Counts still work — they don't touch git
        expect(gone.userCommentCount).toBe(0);
        expect(gone.claudeCommentCount).toBe(0);

        manager.deregister(goneSlug);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('diff and commits', () => {
    it('GET /project/:slug/data returns diff data', async () => {
      const res = await request(app)
        .get(`/project/${slug}/data?item=diff`)
        .expect(200);
      expect(res.body.mode).toBe('diff');
      expect(res.body.diff).toContain('diff --git');
      expect(res.body.meta.branch).toBe('feature');
    });

    it('GET /project/:slug/commits returns commit list', async () => {
      const res = await request(app)
        .get(`/project/${slug}/commits`)
        .expect(200);
      expect(res.body.commits).toBeInstanceOf(Array);
      expect(res.body.commits.length).toBeGreaterThan(0);
      expect(res.body.commits[0].sha).toBeTruthy();
      expect(res.body.commits[0].message).toBeTruthy();
    });
  });

  describe('comments', () => {
    let commentId: string;

    it('POST /project/:slug/comments creates a comment', async () => {
      const res = await request(app)
        .post(`/project/${slug}/comments`)
        .send({ author: 'user', text: 'Test comment', item: 'diff', file: 'src/app.ts', line: 3 })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.comment.id).toBeTruthy();
      expect(res.body.comment.author).toBe('user');
      commentId = res.body.comment.id;
    });

    it('POST /project/:slug/comments returns 400 without required fields', async () => {
      await request(app)
        .post(`/project/${slug}/comments`)
        .send({ author: 'user' })
        .expect(400);
    });

    it('GET /project/:slug/comments lists comments', async () => {
      const res = await request(app)
        .get(`/project/${slug}/comments`)
        .expect(200);
      expect(res.body.comments).toBeInstanceOf(Array);
      expect(res.body.comments.some((c: { id: string }) => c.id === commentId)).toBe(true);
    });

    it('GET /project/:slug/comments supports filter params', async () => {
      const res = await request(app)
        .get(`/project/${slug}/comments?author=user`)
        .expect(200);
      expect(res.body.comments.every((c: { author: string }) => c.author === 'user')).toBe(true);
    });

    it('PATCH /project/:slug/comments/:id updates comment', async () => {
      const res = await request(app)
        .patch(`/project/${slug}/comments/${commentId}`)
        .send({ status: 'resolved' })
        .expect(200);
      expect(res.body.comment.status).toBe('resolved');
    });

    it('DELETE /project/:slug/comments/:id removes comment', async () => {
      await request(app)
        .delete(`/project/${slug}/comments/${commentId}`)
        .expect(200);
      const res = await request(app)
        .get(`/project/${slug}/comments`)
        .expect(200);
      expect(res.body.comments.some((c: { id: string }) => c.id === commentId)).toBe(false);
    });

    it('PATCH returns 404 for nonexistent comment', async () => {
      await request(app)
        .patch(`/project/${slug}/comments/nonexistent`)
        .send({ text: 'Updated' })
        .expect(404);
    });

    it('POST /comments direct mode with X-LGTM-Host: periscope returns a channel payload', async () => {
      const res = await request(app)
        .post(`/project/${slug}/comments`)
        .set('X-LGTM-Host', 'periscope')
        .send({ author: 'user', text: 'Why this approach?', item: 'diff', mode: 'direct' })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.channel).toBeDefined();
      expect(res.body.channel.content).toContain('Why this approach?');
      expect(res.body.channel.meta.event).toBe('question');
    });

    // Guard test: review-mode comments must never carry a channel payload.
    // Note this passes against an unimplemented server too — the test that
    // actually proves the feature is the direct-mode one above.
    it('POST /comments review mode does not return a channel payload', async () => {
      const res = await request(app)
        .post(`/project/${slug}/comments`)
        .set('X-LGTM-Host', 'periscope')
        .send({ author: 'user', text: 'nit', item: 'diff' })
        .expect(200);
      expect(res.body.channel).toBeUndefined();
    });
  });

  describe('user state', () => {
    it('GET /project/:slug/user-state returns defaults', async () => {
      const res = await request(app)
        .get(`/project/${slug}/user-state`)
        .expect(200);
      expect(res.body.reviewedFiles).toBeInstanceOf(Array);
      expect(res.body.sortMode).toBe('path');
      expect(res.body.groupMode).toBe('none');
      expect(res.body.groupModeUserTouched).toBe(false);
      expect(res.body.collapsedFolders).toEqual({});
    });

    it('PUT /project/:slug/user-state/reviewed toggles file', async () => {
      const res = await request(app)
        .put(`/project/${slug}/user-state/reviewed`)
        .send({ path: 'src/app.ts' })
        .expect(200);
      expect(res.body.reviewed).toBe(true);
    });

    it('PUT /project/:slug/user-state/reviewed returns 400 without path', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/reviewed`)
        .send({})
        .expect(400);
    });

    it('PUT /project/:slug/user-state/sidebar-prefs accepts partial updates', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-prefs`)
        .send({ sortMode: 'priority' })
        .expect(200);
      const res = await request(app)
        .get(`/project/${slug}/user-state`)
        .expect(200);
      expect(res.body.sortMode).toBe('priority');
      expect(res.body.groupMode).toBe('none');
    });

    it('PUT /project/:slug/user-state/sidebar-prefs persists collapsedFolders', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-prefs`)
        .send({ collapsedFolders: { 'frontend/src/': true } })
        .expect(200);
      const res = await request(app)
        .get(`/project/${slug}/user-state`)
        .expect(200);
      expect(res.body.collapsedFolders).toEqual({ 'frontend/src/': true });
    });

    it('PUT /project/:slug/user-state/sidebar-prefs rejects non-boolean collapsedFolders values', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-prefs`)
        .send({ collapsedFolders: { 'a/': 'yes' } })
        .expect(400);
    });

    it('PUT /project/:slug/user-state/sidebar-prefs rejects invalid sortMode', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-prefs`)
        .send({ sortMode: 'nope' })
        .expect(400);
    });

    it('PUT /project/:slug/user-state/sidebar-prefs rejects invalid groupMode', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-prefs`)
        .send({ groupMode: 'bogus' })
        .expect(400);
    });
  });

  describe('submit', () => {
    it('POST /project/:slug/submit returns round number', async () => {
      const res = await request(app)
        .post(`/project/${slug}/submit`)
        .send({ comments: 'Looks good!' })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.round).toBe(1);
    });

    it('POST /submit with X-LGTM-Host: periscope returns a channel payload', async () => {
      const res = await request(app)
        .post(`/project/${slug}/submit`)
        .set('X-LGTM-Host', 'periscope')
        .send({ comments: 'Periscope-routed feedback' })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.round).toBe('number');
      expect(res.body.channel).toBeDefined();
      expect(res.body.channel.content).toBe('Periscope-routed feedback');
      expect(res.body.channel.meta.event).toBe('review_submitted');
      expect(res.body.channel.meta.round).toBe(String(res.body.round));
    });

    it('POST /submit without the host header omits the channel payload', async () => {
      const res = await request(app)
        .post(`/project/${slug}/submit`)
        .send({ comments: 'Normal feedback' })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.channel).toBeUndefined();
    });
  });

  describe('submit to GitHub', () => {
    it('POST /project/:slug/submit-github returns 400 when no PR detected', async () => {
      const res = await request(app)
        .post(`/project/${slug}/submit-github`)
        .send({ event: 'COMMENT' })
        .expect(400);
      expect(res.body.error).toContain('No PR detected');
    });
  });

  describe('GET /project/:slug/walkthrough', () => {
    it('returns null when not generated', async () => {
      const res = await request(app).get(`/project/${slug}/walkthrough`).expect(200);
      expect(res.body.walkthrough).toBeNull();
      expect(res.body.stale).toBe(false);
    });

    it('returns walkthrough with stale=false after generation', async () => {
      const session = manager.get(slug)!;
      const { getBranchDiff } = await import('../git-ops.js');
      const { sha256Hex } = await import('../diff-hash.js');
      const diff = getBranchDiff(session.repoPath, session.baseBranch);
      session.setWalkthrough({
        summary: 'x',
        stops: [{ id: 'stop-1', order: 1, title: 't', narrative: 'n', importance: 'primary',
          artifacts: [{ file: 'a.ts', hunks: [{ newStart: 1, newLines: 2 }] }] }],
        diffHash: sha256Hex(diff),
        generatedAt: new Date().toISOString(),
      });
      const res = await request(app).get(`/project/${slug}/walkthrough`).expect(200);
      expect(res.body.walkthrough.stops).toHaveLength(1);
      expect(res.body.stale).toBe(false);
    });

    it('returns stale=true when diffHash mismatches', async () => {
      const session = manager.get(slug)!;
      session.setWalkthrough({
        summary: 'x',
        stops: [{ id: 'stop-1', order: 1, title: 't', narrative: 'n', importance: 'primary',
          artifacts: [{ file: 'a.ts', hunks: [{ newStart: 1, newLines: 2 }] }] }],
        diffHash: 'deadbeef',
        generatedAt: new Date().toISOString(),
      });
      const res = await request(app).get(`/project/${slug}/walkthrough`).expect(200);
      expect(res.body.stale).toBe(true);
    });
  });

  describe('analysis freshness', () => {
    it('GET /analysis/freshness returns 404 when analysis is unset', async () => {
      const session = manager.get(slug)!;
      // Ensure no analysis has leaked in from earlier tests in this describe.
      // Cast through unknown because _analysis is a private field, but at the
      // start of this test we want to assert the 404 path works on an empty
      // session.
      (session as unknown as { _analysis: unknown; _freshnessCache: unknown })._analysis = null;
      (session as unknown as { _analysis: unknown; _freshnessCache: unknown })._freshnessCache = null;

      const res = await request(app).get(`/project/${slug}/analysis/freshness`);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('analysis');
    });

    it('GET /analysis/freshness returns the freshness shape when analysis is set', async () => {
      const session = manager.get(slug)!;
      const blobMap = session.getCurrentBlobMap();
      const paths = Object.keys(blobMap.blobsByPath);
      expect(paths.length).toBeGreaterThan(0); // fixture has a diff

      session.setAnalysis({
        overview: 'o',
        reviewStrategy: 's',
        files: {
          [paths[0]]: { priority: 'normal', phase: 'review', summary: '', category: '' },
        },
        groups: [],
        synthesizedAtFileSet: [paths[0]],
      });

      const res = await request(app).get(`/project/${slug}/analysis/freshness`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.staleFiles)).toBe(true);
      expect(Array.isArray(res.body.missingFiles)).toBe(true);
      expect(Array.isArray(res.body.removedFiles)).toBe(true);
      expect(typeof res.body.staleSynthesis).toBe('boolean');
      expect(typeof res.body.computedAtHead).toBe('string');
      expect(typeof res.body.computedAtBase).toBe('string');
      // Should NOT include the heavy analysis blob.
      expect(res.body.analysis).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('returns 404 for unknown project slug', async () => {
      await request(app)
        .get('/project/nonexistent/data')
        .expect(404);
    });

    it('DELETE /projects/:slug returns 404 for unknown project', async () => {
      await request(app)
        .delete('/projects/nonexistent')
        .expect(404);
    });
  });

  describe('connection state', () => {
    it('GET /connection-state reports claimed=false for an unclaimed project', async () => {
      const f = createGitFixture();
      try {
        const reg = manager.register(f.repoPath);
        const res = await request(app).get(`/project/${reg.slug}/connection-state`);
        expect(res.status).toBe(200);
        expect(res.body.claimed).toBe(false);
        expect(res.body.alive).toBe(false);
        expect(res.body.claimedAt).toBeNull();
      } finally {
        f.cleanup();
      }
    });
  });

  describe('refresh analysis', () => {
    it('POST /refresh-analysis returns delivered=false when no claim exists', async () => {
      const f = createGitFixture();
      try {
        const reg = manager.register(f.repoPath);
        const session = manager.get(reg.slug)!;
        const blobMap = session.getCurrentBlobMap();
        const paths = Object.keys(blobMap.blobsByPath);
        if (paths.length === 0) return; // skip in fixtures with no diff
        const path = paths[0];
        session.setAnalysis({
          overview: 'o', reviewStrategy: 's',
          files: { [path]: { priority: 'normal', phase: 'review', summary: '', category: '' } },
          groups: [],
          synthesizedAtFileSet: [path],
        });

        const res = await request(app).post(`/project/${reg.slug}/refresh-analysis`);
        expect(res.status).toBe(200);
        expect(res.body.delivered).toBe(false);
        expect(typeof res.body.reason).toBe('string');
      } finally {
        f.cleanup();
      }
    });

    it('POST /refresh-analysis returns 404 when no analysis is set', async () => {
      const f = createGitFixture();
      try {
        const reg = manager.register(f.repoPath);
        const res = await request(app).post(`/project/${reg.slug}/refresh-analysis`);
        expect(res.status).toBe(404);
        expect(res.body.delivered).toBe(false);
        expect(typeof res.body.reason).toBe('string');
      } finally {
        f.cleanup();
      }
    });

    it('POST /refresh-analysis with X-LGTM-Host: periscope returns a channel payload and bypasses the claim check', async () => {
      const f = createGitFixture();
      try {
        const reg = manager.register(f.repoPath);
        const session = manager.get(reg.slug)!;
        const blobMap = session.getCurrentBlobMap();
        const paths = Object.keys(blobMap.blobsByPath);
        if (paths.length === 0) return; // skip in fixtures with no diff
        const path = paths[0];
        session.setAnalysis({
          overview: 'o', reviewStrategy: 's',
          files: { [path]: { priority: 'normal', phase: 'review', summary: '', category: '' } },
          groups: [],
          synthesizedAtFileSet: [path],
        });

        const res = await request(app)
          .post(`/project/${reg.slug}/refresh-analysis`)
          .set('X-LGTM-Host', 'periscope');
        expect(res.status).toBe(200);
        expect(res.body.delivered).toBe(true);
        expect(res.body.channel).toBeDefined();
        expect(res.body.channel.meta.event).toBe('refresh_analysis_requested');
        expect(typeof res.body.channel.content).toBe('string');
      } finally {
        f.cleanup();
      }
    });
  });
});
