import { describe, it, expect } from 'vitest';
import { formatDiffComments, formatClaudeInteractions } from '../format-comments';
import type { Comment } from '../comment-types';
import type { DiffFile } from '../state';

const SAMPLE_FILE: DiffFile = {
  path: 'src/app.ts',
  additions: 2,
  deletions: 1,
  lines: [
    { type: 'context', content: 'import foo', oldLine: 1, newLine: 1 },
    { type: 'del', content: 'const old = 1', oldLine: 2, newLine: null },
    { type: 'add', content: 'const new1 = 1', oldLine: null, newLine: 2 },
    { type: 'add', content: 'const new2 = 2', oldLine: null, newLine: 3 },
  ],
};

describe('formatDiffComments', () => {
  it('formats user review comments grouped by file', () => {
    const comments: Comment[] = [
      { id: '1', author: 'user', text: 'Why this change?', status: 'active', item: 'diff', file: 'src/app.ts', line: 2, mode: 'review' },
    ];
    const result = formatDiffComments(comments, [SAMPLE_FILE]);
    expect(result).toContain('## src/app.ts');
    expect(result).toContain('Why this change?');
    expect(result).toContain('Line 2');
  });

  it('excludes replies and dismissed comments', () => {
    const comments: Comment[] = [
      { id: '1', author: 'user', text: 'visible', status: 'active', item: 'diff', file: 'src/app.ts', line: 2, mode: 'review' },
      { id: '2', author: 'user', text: 'reply', status: 'active', item: 'diff', file: 'src/app.ts', line: 2, parentId: '1' },
      { id: '3', author: 'user', text: 'dismissed', status: 'dismissed', item: 'diff', file: 'src/app.ts', line: 3, mode: 'review' },
    ];
    const result = formatDiffComments(comments, [SAMPLE_FILE]);
    expect(result).toContain('visible');
    expect(result).not.toContain('reply');
    expect(result).not.toContain('dismissed');
  });

  it('returns empty string when no comments', () => {
    expect(formatDiffComments([], [SAMPLE_FILE])).toBe('');
  });
});

describe('formatClaudeInteractions', () => {
  it('formats claude comments with user replies', () => {
    const comments: Comment[] = [
      { id: 'c1', author: 'claude', text: 'Consider renaming', status: 'active', item: 'diff', file: 'src/app.ts', line: 2 },
      { id: 'r1', author: 'user', text: 'Good point', status: 'active', item: 'diff', file: 'src/app.ts', line: 2, parentId: 'c1' },
    ];
    const result = formatClaudeInteractions(comments);
    expect(result).toContain('**Claude:** Consider renaming');
    expect(result).toContain('**Reply:** Good point');
  });

  it('formats resolved claude comments', () => {
    const comments: Comment[] = [
      { id: 'c1', author: 'claude', text: 'Fix this', status: 'resolved', item: 'diff', file: 'src/app.ts', line: 2 },
    ];
    const result = formatClaudeInteractions(comments);
    expect(result).toContain('**Status:** Resolved');
  });

  it('skips claude comments with no reply and not resolved', () => {
    const comments: Comment[] = [
      { id: 'c1', author: 'claude', text: 'Ignored', status: 'active', item: 'diff', file: 'src/app.ts', line: 2 },
    ];
    const result = formatClaudeInteractions(comments);
    expect(result).toBe('');
  });
});
