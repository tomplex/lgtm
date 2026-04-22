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
      // userCommentCount: a1 active, a2 resolved → counted; a3 dismissed → excluded; reply → excluded. Count = 2.
      expect(project.userCommentCount).toBe(2);
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

    it('PUT /project/:slug/user-state/sidebar-prefs merges collapsedFolders', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-prefs`)
        .send({ collapsedFolders: { 'frontend/src/': true } })
        .expect(200);
      const res = await request(app)
        .get(`/project/${slug}/user-state`)
        .expect(200);
      expect(res.body.collapsedFolders).toEqual({ 'frontend/src/': true });
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
});
