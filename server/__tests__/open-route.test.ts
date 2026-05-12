import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import { initStore, closeStore } from '../store.js';
import { SessionManager } from '../session-manager.js';
import { createApp } from '../app.js';

// On macOS, mkdtempSync returns /var/folders/... but git rev-parse --show-toplevel
// returns the realpath /private/var/folders/...; canonicalize so the test's
// pre-register call and /open's lookup land on the same key in the manager.
function repoRootOf(path: string): string {
  return execFileSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf-8',
  }).trim();
}

describe('GET /open', () => {
  let tmpDir: string;
  let app: ReturnType<typeof createApp>;
  let manager: SessionManager;
  const fixtures: GitFixture[] = [];

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-open-test-'));
    initStore(join(tmpDir, 'test.db'));
    manager = new SessionManager(9999);
    app = createApp(manager);
  });

  afterAll(() => {
    for (const project of manager.list()) {
      manager.deregister(project.slug);
    }
    closeStore();
    for (const f of fixtures) f.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('redirects to /project/<slug>/ for already-registered repo', async () => {
    const fixture = createGitFixture();
    fixtures.push(fixture);
    const { slug } = manager.register(repoRootOf(fixture.repoPath));

    const res = await request(app).get('/open').query({ path: fixture.repoPath });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/project/${slug}/`);
  });

  it('auto-registers an unregistered git repo, then redirects', async () => {
    const fixture = createGitFixture();
    fixtures.push(fixture);
    const repoRoot = repoRootOf(fixture.repoPath);

    expect(manager.findByRepoPath(repoRoot)).toBeUndefined();

    const res = await request(app).get('/open').query({ path: fixture.repoPath });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/project\/[a-z0-9-]+\/$/);

    const after = manager.findByRepoPath(repoRoot);
    expect(after).toBeDefined();
    expect(res.headers.location).toBe(`/project/${after!.slug}/`);
  });

  it('returns 400 for non-git path', async () => {
    const nonGit = `/tmp/lgtm-not-a-git-repo-${Date.now()}`;
    const res = await request(app).get('/open').query({ path: nonGit });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a git repository/i);
  });

  it('returns 400 when path query param is missing', async () => {
    const res = await request(app).get('/open');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path/i);
  });
});
