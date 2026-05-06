import { describe, it, expect } from 'vitest';
import { computeFreshness } from '../freshness.js';
import type { FileAnalysis } from '../parse-analysis.js';
import type { RawDiffEntry } from '../git-ops.js';

const fa = (extra: Partial<FileAnalysis> = {}): FileAnalysis => ({
  priority: 'normal',
  phase: 'review',
  summary: '',
  category: '',
  analyzedAtBaseBlob: 'BASE',
  analyzedAtHeadBlob: 'HEAD',
  ...extra,
});

const rd = (oldBlob: string, newBlob: string, status = 'M'): RawDiffEntry => ({
  oldBlob, newBlob, status,
});

describe('computeFreshness', () => {
  it('marks files as fresh when both blobs match', () => {
    const result = computeFreshness({
      storedFiles: { 'a.ts': fa() },
      currentDiff: new Map([['a.ts', rd('BASE', 'HEAD')]]),
      synthesizedAtFileSet: ['a.ts'],
    });
    expect(result.staleFiles).toEqual([]);
    expect(result.missingFiles).toEqual([]);
    expect(result.removedFiles).toEqual([]);
    expect(result.staleSynthesis).toBe(false);
  });

  it('marks file as stale when newBlob differs', () => {
    const result = computeFreshness({
      storedFiles: { 'a.ts': fa() },
      currentDiff: new Map([['a.ts', rd('BASE', 'NEW_HEAD')]]),
      synthesizedAtFileSet: ['a.ts'],
    });
    expect(result.staleFiles).toEqual(['a.ts']);
    expect(result.staleSynthesis).toBe(true);
  });

  it('marks file as stale when oldBlob differs (base advanced)', () => {
    const result = computeFreshness({
      storedFiles: { 'a.ts': fa() },
      currentDiff: new Map([['a.ts', rd('NEW_BASE', 'HEAD')]]),
      synthesizedAtFileSet: ['a.ts'],
    });
    expect(result.staleFiles).toEqual(['a.ts']);
  });

  it('flags files in current diff but not in stored as missing', () => {
    const result = computeFreshness({
      storedFiles: {},
      currentDiff: new Map([['new.ts', rd('0', 'X', 'A')]]),
      synthesizedAtFileSet: [],
    });
    expect(result.missingFiles).toEqual(['new.ts']);
    expect(result.staleSynthesis).toBe(true);
  });

  it('flags files in stored but not in current diff as removed', () => {
    const result = computeFreshness({
      storedFiles: { 'gone.ts': fa() },
      currentDiff: new Map(),
      synthesizedAtFileSet: ['gone.ts'],
    });
    expect(result.removedFiles).toEqual(['gone.ts']);
    expect(result.staleSynthesis).toBe(true);
  });

  it('treats stored entries with absent blob fields as fully stale (legacy migration)', () => {
    const legacy: FileAnalysis = { priority: 'normal', phase: 'review', summary: '', category: '' };
    const result = computeFreshness({
      storedFiles: { 'a.ts': legacy },
      currentDiff: new Map([['a.ts', rd('BASE', 'HEAD')]]),
      synthesizedAtFileSet: ['a.ts'],
    });
    expect(result.staleFiles).toEqual(['a.ts']);
  });

  it('flags synthesis as stale when fileSet differs even if all files are fresh', () => {
    const result = computeFreshness({
      storedFiles: {
        'a.ts': fa(),
        'b.ts': fa({ analyzedAtBaseBlob: 'B2', analyzedAtHeadBlob: 'H2' }),
      },
      currentDiff: new Map([
        ['a.ts', rd('BASE', 'HEAD')],
        ['b.ts', rd('B2', 'H2')],
      ]),
      synthesizedAtFileSet: ['a.ts'], // b.ts not in synthesis fileSet
    });
    expect(result.staleFiles).toEqual([]);
    expect(result.staleSynthesis).toBe(true);
  });
});
