import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initStore, closeStore, storeGet, storePut, storeDelete, storeList, type ProjectBlob } from '../store.js';

function makeBlob(slug: string, overrides?: Partial<ProjectBlob>): ProjectBlob {
  return {
    slug,
    repoPath: `/tmp/test-${slug}`,
    baseBranch: 'main',
    description: '',
    items: [{ id: 'diff', type: 'diff', title: 'Code Changes' }],
    comments: [],
    analysis: null,
    rounds: {},
    reviewedFiles: [],
    sidebarView: 'flat',
    ...overrides,
  };
}

describe('store', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-store-test-'));
    initStore(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeStore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('storeGet returns null for missing slug', () => {
    expect(storeGet('nonexistent')).toBeNull();
  });

  it('storePut + storeGet round-trips a blob', () => {
    const blob = makeBlob('test-project');
    storePut('test-project', blob);
    const retrieved = storeGet('test-project');
    expect(retrieved).toEqual(blob);
  });

  it('storePut upserts — overwrites existing entry', () => {
    const blob1 = makeBlob('upsert-test', { description: 'first' });
    storePut('upsert-test', blob1);
    const blob2 = makeBlob('upsert-test', { description: 'second' });
    storePut('upsert-test', blob2);
    const retrieved = storeGet('upsert-test');
    expect(retrieved?.description).toBe('second');
  });

  it('storeDelete removes entry', () => {
    const blob = makeBlob('delete-me');
    storePut('delete-me', blob);
    expect(storeGet('delete-me')).not.toBeNull();
    storeDelete('delete-me');
    expect(storeGet('delete-me')).toBeNull();
  });

  it('storeList returns all entries', () => {
    // Clean slate — delete known keys from prior tests
    storeDelete('test-project');
    storeDelete('upsert-test');

    storePut('list-a', makeBlob('list-a'));
    storePut('list-b', makeBlob('list-b'));
    const list = storeList();
    const slugs = list.map(b => b.slug);
    expect(slugs).toContain('list-a');
    expect(slugs).toContain('list-b');
  });

  it('preserves complex blob data through JSON round-trip', () => {
    const blob = makeBlob('complex', {
      comments: [
        { id: 'c1', author: 'claude', text: 'test', status: 'active', item: 'diff', file: 'app.ts', line: 10 },
      ],
      analysis: { files: { 'app.ts': { priority: 'critical' } } },
      rounds: { diff: 2 },
      reviewedFiles: ['app.ts', 'utils.ts'],
      sidebarView: 'grouped',
    });
    storePut('complex', blob);
    const retrieved = storeGet('complex');
    expect(retrieved?.comments).toHaveLength(1);
    expect(retrieved?.comments[0].id).toBe('c1');
    expect(retrieved?.analysis).toEqual({ files: { 'app.ts': { priority: 'critical' } } });
    expect(retrieved?.rounds).toEqual({ diff: 2 });
    expect(retrieved?.reviewedFiles).toEqual(['app.ts', 'utils.ts']);
    expect(retrieved?.sidebarView).toBe('grouped');
  });
});
