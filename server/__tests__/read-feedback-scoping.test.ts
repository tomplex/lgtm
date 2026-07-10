import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import { initStore, closeStore } from '../store.js';
import { SessionManager } from '../session-manager.js';
import { createApp } from '../app.js';
import { mountMcp } from '../mcp.js';
import { createMcpClient, type McpClient } from './helpers/mcp-client.js';
import { CommentStore } from '../comment-store.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('read_feedback claim scoping', () => {
  let fixture: GitFixture;
  let tmpDir: string;
  let app: ReturnType<typeof createApp>;
  let manager: SessionManager;
  let client: McpClient;
  let slug: string;

  const postUserComment = async (text: string, item = 'diff') => {
    const r = await request(app)
      .post(`/project/${slug}/comments`)
      .send({ author: 'user', text, item, line: 1 })
      .expect(200);
    return r.body.comment.id as string;
  };

  beforeAll(async () => {
    fixture = createGitFixture();
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-feedback-scope-test-'));
    initStore(join(tmpDir, 'test.db'));
    manager = new SessionManager(9999);
    app = createApp(manager);
    mountMcp(app, manager);
    // Register WITHOUT an MCP claim so comments can predate the claim.
    slug = manager.register(fixture.repoPath).slug;
    client = await createMcpClient(app);
  });

  afterAll(async () => {
    await client.close();
    for (const project of manager.list()) manager.deregister(project.slug);
    closeStore();
    fixture.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stamps createdAt on new comments', () => {
    const c = new CommentStore().add({ author: 'user', text: 'x', item: 'diff' });
    expect(c.createdAt).toBeDefined();
    expect(Number.isNaN(Date.parse(c.createdAt!))).toBe(false);
  });

  it('splits pre-claim backlog from post-claim feedback', async () => {
    await postUserComment('old backlog comment');
    await sleep(10); // ensure the claim timestamp lands strictly after
    const claim = await client.callTool('claim_reviews', { repoPath: fixture.repoPath });
    expect(claim.error).toBeUndefined();
    await sleep(10); // ensure the fresh comment lands strictly after the claim
    await postUserComment('fresh session comment');

    const res = await client.callTool('read_feedback', { repoPath: fixture.repoPath });
    const text = res.text ?? '';
    expect(text).toContain('# New since this session claimed the review (1)');
    expect(text).toContain('# Earlier pending comments (1)');
    // Fresh section comes first and contains only the fresh comment.
    const freshSection = text.split('# Earlier pending comments')[0];
    expect(freshSection).toContain('fresh session comment');
    expect(freshSection).not.toContain('old backlog comment');
    const earlierSection = text.split('# Earlier pending comments')[1];
    expect(earlierSection).toContain('old backlog comment');
    expect(earlierSection).toContain('Confirm with the user');
  });

  it('omits the earlier section once the backlog is resolved', async () => {
    const feedback = await client.callTool('read_feedback', { repoPath: fixture.repoPath });
    const idMatches = [...(feedback.text ?? '').matchAll(/\(id: ([0-9a-f-]{36})\)/g)];
    const earlierText = (feedback.text ?? '').split('# Earlier pending comments')[1] ?? '';
    const backlogIds = idMatches.map(m => m[1]).filter(id => earlierText.includes(id));
    expect(backlogIds.length).toBe(1);

    const res = await client.callTool('resolve_comments', {
      repoPath: fixture.repoPath,
      resolutions: backlogIds.map(id => ({ id, note: 'handled' })),
    });
    expect(res.error).toBeUndefined();

    const after = await client.callTool('read_feedback', { repoPath: fixture.repoPath });
    expect(after.text).not.toContain('# Earlier pending comments');
    expect(after.text).toContain('fresh session comment');
  });

  it('filters by item', async () => {
    await postUserComment('doc tab comment', 'my-design-doc');

    const diffOnly = await client.callTool('read_feedback', { repoPath: fixture.repoPath, item: 'diff' });
    expect(diffOnly.text).toContain('fresh session comment');
    expect(diffOnly.text).not.toContain('doc tab comment');

    const docOnly = await client.callTool('read_feedback', { repoPath: fixture.repoPath, item: 'my-design-doc' });
    expect(docOnly.text).toContain('doc tab comment');
    expect(docOnly.text).not.toContain('fresh session comment');
  });

  it('treats comments without createdAt as earlier backlog', async () => {
    // Simulate a comment persisted before timestamps existed.
    const session = manager.get(slug)!;
    const legacy = session.addComment({ author: 'user', text: 'legacy pre-timestamp comment', item: 'diff' });
    const stored = session.getComment(legacy.id)!;
    delete stored.createdAt;

    const res = await client.callTool('read_feedback', { repoPath: fixture.repoPath, item: 'diff' });
    const earlierSection = (res.text ?? '').split('# Earlier pending comments')[1] ?? '';
    expect(earlierSection).toContain('legacy pre-timestamp comment');
  });
});
