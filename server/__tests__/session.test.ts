import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import { initStore, closeStore, storeGet } from '../store.js';
import { Session, type SSEClient } from '../session.js';

describe('Session', () => {
  let fixture: GitFixture;
  let tmpDir: string;
  let outputPath: string;

  beforeAll(() => {
    fixture = createGitFixture();
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-session-test-'));
    initStore(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeStore();
    fixture.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeSession(slug = 'test-session'): Session {
    outputPath = join(tmpDir, `${slug}.md`);
    return new Session({
      repoPath: fixture.repoPath,
      baseBranch: 'main',
      description: 'Test review',
      outputPath,
      slug,
    });
  }

  describe('comments', () => {
    it('addComment returns comment with generated ID and active status', () => {
      const session = makeSession('comment-test');
      const comment = session.addComment({
        author: 'user',
        text: 'Looks wrong',
        item: 'diff',
        file: 'src/app.ts',
        line: 5,
      });
      expect(comment.id).toBeTruthy();
      expect(comment.status).toBe('active');
      expect(comment.author).toBe('user');
      expect(comment.text).toBe('Looks wrong');
    });

    it('updateComment changes text and status', () => {
      const session = makeSession('comment-update');
      const comment = session.addComment({ author: 'claude', text: 'Fix this', item: 'diff' });
      const updated = session.updateComment(comment.id, { status: 'resolved' });
      expect(updated?.status).toBe('resolved');
      const updated2 = session.updateComment(comment.id, { text: 'Actually fine' });
      expect(updated2?.text).toBe('Actually fine');
    });

    it('deleteComment removes comment', () => {
      const session = makeSession('comment-delete');
      const comment = session.addComment({ author: 'user', text: 'Remove me', item: 'diff' });
      expect(session.listComments()).toHaveLength(1);
      session.deleteComment('diff', comment.id);
      expect(session.listComments()).toHaveLength(0);
    });

    it('listComments filters by item, author, file', () => {
      const session = makeSession('comment-filter');
      session.addComment({ author: 'user', text: 'User on diff', item: 'diff', file: 'a.ts' });
      session.addComment({ author: 'claude', text: 'Claude on diff', item: 'diff', file: 'b.ts' });
      session.addComment({ author: 'user', text: 'User on doc', item: 'doc1' });

      expect(session.listComments({ item: 'diff' })).toHaveLength(2);
      expect(session.listComments({ author: 'claude' })).toHaveLength(1);
      expect(session.listComments({ item: 'diff', file: 'a.ts' })).toHaveLength(1);
    });

    it('addComments batch-adds Claude comments', () => {
      const session = makeSession('comment-batch');
      const count = session.addComments('diff', [
        { file: 'a.ts', line: 1, comment: 'First' },
        { file: 'b.ts', line: 2, comment: 'Second' },
      ]);
      expect(count).toBe(2);
      const all = session.listComments({ author: 'claude' });
      expect(all).toHaveLength(2);
    });
  });

  describe('items', () => {
    it('starts with diff item', () => {
      const session = makeSession('items-default');
      expect(session.items).toHaveLength(1);
      expect(session.items[0].id).toBe('diff');
    });

    it('addItem adds a document item', () => {
      const session = makeSession('items-add');
      session.addItem('design-doc', 'Design Doc', join(fixture.repoPath, 'README.md'));
      expect(session.items).toHaveLength(2);
      expect(session.items[1].id).toBe('design-doc');
    });

    it('removeItem removes item and its comments', () => {
      const session = makeSession('items-remove');
      session.addItem('temp-doc', 'Temp', join(fixture.repoPath, 'README.md'));
      session.addComment({ author: 'user', text: 'On temp doc', item: 'temp-doc', block: 0 });
      expect(session.listComments({ item: 'temp-doc' })).toHaveLength(1);
      const removed = session.removeItem('temp-doc');
      expect(removed).toBe(true);
      expect(session.items).toHaveLength(1);
      expect(session.listComments({ item: 'temp-doc' })).toHaveLength(0);
    });

    it('cannot remove diff item', () => {
      const session = makeSession('items-no-remove-diff');
      expect(session.removeItem('diff')).toBe(false);
      expect(session.items).toHaveLength(1);
    });
  });

  describe('getItemData', () => {
    it('returns diff data for diff item', () => {
      const session = makeSession('data-diff');
      const data = session.getItemData('diff');
      expect(data.mode).toBe('diff');
      expect(data.diff).toContain('diff --git');
      expect(data.meta).toBeDefined();
      expect((data.meta as Record<string, unknown>).branch).toBe('feature');
    });

    it('returns file content for document item', () => {
      const session = makeSession('data-doc');
      session.addItem('readme', 'README', join(fixture.repoPath, 'README.md'));
      const data = session.getItemData('readme');
      expect(data.mode).toBe('file');
      expect(data.content).toContain('Test Project');
      expect(data.markdown).toBe(true);
    });

    it('returns error for unknown item', () => {
      const session = makeSession('data-unknown');
      const data = session.getItemData('nonexistent');
      expect(data.mode).toBe('error');
    });
  });

  describe('user state', () => {
    it('toggleUserReviewedFile flips state', () => {
      const session = makeSession('user-reviewed');
      expect(session.toggleUserReviewedFile('app.ts')).toBe(true);
      expect(session.userReviewedFiles).toContain('app.ts');
      expect(session.toggleUserReviewedFile('app.ts')).toBe(false);
      expect(session.userReviewedFiles).not.toContain('app.ts');
    });

    it('setUserSidebarPrefs persists', () => {
      const session = makeSession('user-sidebar');
      session.setUserSidebarPrefs({ sortMode: 'priority' });
      expect(session.userSidebarPrefs.sortMode).toBe('priority');
    });
  });

  describe('submitReview', () => {
    it('writes markdown to output file and increments round', async () => {
      const session = makeSession('submit-test');
      const round1 = await session.submitReview('First round comments');
      expect(round1).toBe(1);
      expect(existsSync(outputPath)).toBe(true);
      expect(readFileSync(outputPath, 'utf-8')).toContain('Review Round 1');
      expect(readFileSync(outputPath, 'utf-8')).toContain('First round comments');

      const round2 = await session.submitReview('Second round');
      expect(round2).toBe(2);
      expect(readFileSync(outputPath, 'utf-8')).toContain('Review Round 2');
    });

    it('writes signal file with round number', async () => {
      const session = makeSession('signal-test');
      await session.submitReview('Test');
      const signal = readFileSync(outputPath + '.signal', 'utf-8');
      expect(signal).toBe('diff:1');
    });
  });

  describe('persistence', () => {
    it('persist + fromBlob reconstructs session state', () => {
      const session = makeSession('persist-test');
      session.addComment({ author: 'user', text: 'Persisted comment', item: 'diff', file: 'a.ts', line: 1 });
      session.addItem('doc1', 'Design', join(fixture.repoPath, 'README.md'));
      session.toggleUserReviewedFile('src/app.ts');
      session.setUserSidebarPrefs({ sortMode: 'priority' });
      session.persist();

      const blob = storeGet('persist-test');
      expect(blob).not.toBeNull();
      const restored = Session.fromBlob(blob as unknown as Record<string, unknown>, outputPath);
      expect(restored.listComments()).toHaveLength(1);
      expect(restored.listComments()[0].text).toBe('Persisted comment');
      expect(restored.items).toHaveLength(2);
      expect(restored.userReviewedFiles).toContain('src/app.ts');
      expect(restored.userSidebarPrefs.sortMode).toBe('priority');
    });
  });

  describe('SSE', () => {
    it('broadcast sends event to subscribed clients', () => {
      const session = makeSession('sse-test');
      const received: { event: string; data: unknown }[] = [];
      const client: SSEClient = {
        send(event, data) { received.push({ event, data }); },
      };
      session.subscribe(client);
      session.broadcast('comments_changed', { item: 'diff' });
      expect(received).toHaveLength(1);
      expect(received[0].event).toBe('comments_changed');
      expect(received[0].data).toEqual({ item: 'diff' });
    });

    it('unsubscribe stops delivery', () => {
      const session = makeSession('sse-unsub');
      const received: unknown[] = [];
      const client: SSEClient = { send(_, data) { received.push(data); } };
      session.subscribe(client);
      session.unsubscribe(client);
      session.broadcast('test', {});
      expect(received).toHaveLength(0);
    });
  });
});
