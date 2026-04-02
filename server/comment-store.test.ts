import { describe, it, expect, beforeEach } from 'vitest';
import { CommentStore } from './comment-store.js';

describe('CommentStore', () => {
  let store: CommentStore;

  beforeEach(() => {
    store = new CommentStore();
  });

  it('adds a comment and assigns an id and active status', () => {
    const comment = store.add({
      author: 'claude',
      text: 'Looks risky',
      item: 'diff',
      file: 'src/foo.ts',
      line: 42,
    });
    expect(comment.id).toBeDefined();
    expect(comment.status).toBe('active');
    expect(comment.text).toBe('Looks risky');
  });

  it('retrieves a comment by id', () => {
    const added = store.add({ author: 'user', text: 'Why?', item: 'diff', file: 'src/foo.ts', line: 10, mode: 'review' });
    expect(store.get(added.id)).toEqual(added);
  });

  it('returns undefined for unknown id', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('updates text', () => {
    const c = store.add({ author: 'user', text: 'old', item: 'diff', mode: 'review' });
    store.update(c.id, { text: 'new' });
    expect(store.get(c.id)!.text).toBe('new');
  });

  it('updates status', () => {
    const c = store.add({ author: 'claude', text: 'Check this', item: 'diff' });
    store.update(c.id, { status: 'resolved' });
    expect(store.get(c.id)!.status).toBe('resolved');
  });

  it('deletes a comment', () => {
    const c = store.add({ author: 'claude', text: 'x', item: 'diff' });
    expect(store.delete(c.id)).toBe(true);
    expect(store.get(c.id)).toBeUndefined();
    expect(store.delete(c.id)).toBe(false);
  });

  it('filters by item', () => {
    store.add({ author: 'claude', text: 'a', item: 'diff' });
    store.add({ author: 'claude', text: 'b', item: 'spec' });
    expect(store.list({ item: 'diff' })).toHaveLength(1);
    expect(store.list({ item: 'spec' })).toHaveLength(1);
  });

  it('filters by author', () => {
    store.add({ author: 'claude', text: 'a', item: 'diff' });
    store.add({ author: 'user', text: 'b', item: 'diff', mode: 'review' });
    expect(store.list({ author: 'claude' })).toHaveLength(1);
    expect(store.list({ author: 'user' })).toHaveLength(1);
  });

  it('filters by file', () => {
    store.add({ author: 'claude', text: 'a', item: 'diff', file: 'src/a.ts' });
    store.add({ author: 'claude', text: 'b', item: 'diff', file: 'src/b.ts' });
    expect(store.list({ file: 'src/a.ts' })).toHaveLength(1);
  });

  it('filters by parentId', () => {
    const root = store.add({ author: 'claude', text: 'root', item: 'diff' });
    store.add({ author: 'user', text: 'reply', item: 'diff', parentId: root.id });
    expect(store.list({ parentId: root.id })).toHaveLength(1);
  });

  it('filters by status', () => {
    const c = store.add({ author: 'claude', text: 'a', item: 'diff' });
    store.update(c.id, { status: 'dismissed' });
    store.add({ author: 'claude', text: 'b', item: 'diff' });
    expect(store.list({ status: 'active' })).toHaveLength(1);
    expect(store.list({ status: 'dismissed' })).toHaveLength(1);
  });

  it('combines filters', () => {
    store.add({ author: 'claude', text: 'a', item: 'diff', file: 'src/a.ts' });
    store.add({ author: 'user', text: 'b', item: 'diff', file: 'src/a.ts', mode: 'review' });
    store.add({ author: 'claude', text: 'c', item: 'diff', file: 'src/b.ts' });
    expect(store.list({ author: 'claude', file: 'src/a.ts' })).toHaveLength(1);
  });

  it('serializes and deserializes', () => {
    store.add({ author: 'claude', text: 'a', item: 'diff' });
    store.add({ author: 'user', text: 'b', item: 'diff', mode: 'review' });
    const json = store.toJSON();
    const restored = CommentStore.fromJSON(json);
    expect(restored.list()).toEqual(store.list());
  });
});
