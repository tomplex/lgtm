import { describe, it, expect } from 'vitest';
import { migrateBlob } from '../comment-migration.js';

describe('migrateBlob', () => {
  it('converts old-format blob to new format with comments array', () => {
    const oldBlob = {
      slug: 'test',
      repoPath: '/tmp/repo',
      baseBranch: 'main',
      description: '',
      items: [{ id: 'diff', type: 'diff' as const, title: 'Code Changes' }],
      claudeComments: {
        diff: [
          { id: 'cc-1', file: 'src/foo.ts', line: 10, comment: 'Check this' },
          { id: 'cc-2', file: 'src/bar.ts', line: 5, block: undefined, comment: 'Also here' },
        ],
      },
      analysis: null,
      round: 1,
      userComments: {
        'src/foo.ts::3': 'User note on line',
        'doc:spec:2': 'Doc comment',
        'claude:cc-1': 'Reply to Claude',
      },
      reviewedFiles: ['src/foo.ts'],
      resolvedComments: ['claude:cc-2'],
      sidebarView: 'flat',
    };

    const result = migrateBlob(oldBlob);

    // Should have comments array
    expect(result.comments).toBeDefined();
    expect(Array.isArray(result.comments)).toBe(true);

    // Old fields should be removed
    expect(result).not.toHaveProperty('claudeComments');
    expect(result).not.toHaveProperty('userComments');
    expect(result).not.toHaveProperty('resolvedComments');

    // Claude comments migrated
    const claudeComments = result.comments.filter((c: any) => c.author === 'claude' && !c.parentId);
    expect(claudeComments).toHaveLength(2);
    expect(claudeComments[0].text).toBe('Check this');
    expect(claudeComments[0].file).toBe('src/foo.ts');
    expect(claudeComments[0].item).toBe('diff');
    expect(claudeComments[0].status).toBe('active');

    // Resolved Claude comment
    const resolved = result.comments.find((c: any) => c.id === 'cc-2');
    expect(resolved!.status).toBe('resolved');

    // User diff comment migrated
    const userDiffComments = result.comments.filter((c: any) => c.author === 'user' && c.file === 'src/foo.ts' && !c.parentId);
    expect(userDiffComments).toHaveLength(1);
    expect(userDiffComments[0].text).toBe('User note on line');
    expect(userDiffComments[0].mode).toBe('review');
    expect(userDiffComments[0].item).toBe('diff');

    // User doc comment migrated
    const userDocComments = result.comments.filter((c: any) => c.author === 'user' && c.item === 'spec');
    expect(userDocComments).toHaveLength(1);
    expect(userDocComments[0].text).toBe('Doc comment');
    expect(userDocComments[0].block).toBe(2);

    // Reply to Claude migrated
    const replies = result.comments.filter((c: any) => c.parentId === 'cc-1');
    expect(replies).toHaveLength(1);
    expect(replies[0].author).toBe('user');
    expect(replies[0].text).toBe('Reply to Claude');
  });

  it('passes through new-format blob unchanged', () => {
    const newBlob = {
      slug: 'test',
      repoPath: '/tmp/repo',
      baseBranch: 'main',
      description: '',
      items: [],
      comments: [{ id: 'c1', author: 'claude', text: 'hi', status: 'active', item: 'diff' }],
      analysis: null,
      round: 0,
      reviewedFiles: [],
      sidebarView: 'flat',
    };

    const result = migrateBlob(newBlob);
    expect(result.comments).toEqual(newBlob.comments);
  });
});
