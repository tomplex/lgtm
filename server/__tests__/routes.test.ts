import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
      expect(project.repoName).toBe(require('node:path').basename(fixture.repoPath));
      expect(project.branch).toBe('feature');
      expect(project.baseBranch).toBe('main');
      expect(project.pr).toBeNull();
      expect(project.claudeCommentCount).toBe(0);
      expect(project.userCommentCount).toBe(0);
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
      expect(res.body.sidebarView).toBeTruthy();
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

    it('PUT /project/:slug/user-state/sidebar-view sets view', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-view`)
        .send({ view: 'grouped' })
        .expect(200);
      const res = await request(app)
        .get(`/project/${slug}/user-state`)
        .expect(200);
      expect(res.body.sidebarView).toBe('grouped');
    });

    it('PUT /project/:slug/user-state/sidebar-view rejects invalid view', async () => {
      await request(app)
        .put(`/project/${slug}/user-state/sidebar-view`)
        .send({ view: 'invalid' })
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
