import { describe, it, expect } from 'vitest';
import { parseWalkthrough } from '../parse-walkthrough.js';

const EXAMPLE = `## Summary

A short overview of the PR.

## Stop 1

- importance: primary
- title: Analyze entry point restructured

Moves the pipeline out of POST /analyze and into its own module.

### Artifact: server/analyze.ts

- hunk: 1-7

### Artifact: server/app.ts

- hunk: 42-48
- banner: The old inline path becomes a thin delegate.

## Stop 2

- importance: supporting
- title: Priority scoring helper

Adds a small pure function for ranking.

### Artifact: server/classifier.ts

- hunk: 12-20
- hunk: 55-58
`;

describe('parseWalkthrough', () => {
  it('parses summary', () => {
    const w = parseWalkthrough(EXAMPLE);
    expect(w.summary).toBe('A short overview of the PR.');
  });

  it('parses stops in order', () => {
    const w = parseWalkthrough(EXAMPLE);
    expect(w.stops).toHaveLength(2);
    expect(w.stops[0].order).toBe(1);
    expect(w.stops[1].order).toBe(2);
    expect(w.stops[0].id).toBe('stop-1');
    expect(w.stops[1].id).toBe('stop-2');
  });

  it('parses stop metadata', () => {
    const [s1] = parseWalkthrough(EXAMPLE).stops;
    expect(s1.importance).toBe('primary');
    expect(s1.title).toBe('Analyze entry point restructured');
    expect(s1.narrative).toBe('Moves the pipeline out of POST /analyze and into its own module.');
  });

  it('parses artifacts with hunks and banner', () => {
    const [s1] = parseWalkthrough(EXAMPLE).stops;
    expect(s1.artifacts).toHaveLength(2);
    expect(s1.artifacts[0]).toEqual({
      file: 'server/analyze.ts',
      hunks: [{ newStart: 1, newLines: 7 }],
    });
    expect(s1.artifacts[1]).toEqual({
      file: 'server/app.ts',
      hunks: [{ newStart: 42, newLines: 7 }],
      banner: 'The old inline path becomes a thin delegate.',
    });
  });

  it('parses multiple hunks for one artifact', () => {
    const [, s2] = parseWalkthrough(EXAMPLE).stops;
    expect(s2.artifacts[0].hunks).toEqual([
      { newStart: 12, newLines: 9 },
      { newStart: 55, newLines: 4 },
    ]);
  });

  it('rejects invalid importance', () => {
    const bad = EXAMPLE.replace('importance: primary', 'importance: bogus');
    expect(() => parseWalkthrough(bad)).toThrow(/importance/i);
  });

  it('rejects missing summary', () => {
    expect(() => parseWalkthrough('## Stop 1\n- importance: primary\n- title: x\n\nfoo')).toThrow(/summary/i);
  });

  it('rejects missing stops', () => {
    expect(() => parseWalkthrough('## Summary\n\nhi')).toThrow(/stop/i);
  });

  it('accepts title suffix in heading as fallback (em-dash)', () => {
    const md = `## Summary

Test.

## Stop 1 — Cache eviction rule

- importance: primary

A short narrative.

### Artifact: a.ts

- hunk: 1-5
`;
    const w = parseWalkthrough(md);
    expect(w.stops[0].title).toBe('Cache eviction rule');
    expect(w.stops[0].order).toBe(1);
  });

  it('accepts title suffix in heading as fallback (colon)', () => {
    const md = `## Summary

Test.

## Stop 1: Cache eviction rule

- importance: primary

A short narrative.

### Artifact: a.ts

- hunk: 1-5
`;
    const w = parseWalkthrough(md);
    expect(w.stops[0].title).toBe('Cache eviction rule');
  });

  it('accepts title suffix in heading as fallback (hyphen)', () => {
    const md = `## Summary

Test.

## Stop 1 - Cache eviction rule

- importance: primary

A short narrative.

### Artifact: a.ts

- hunk: 1-5
`;
    const w = parseWalkthrough(md);
    expect(w.stops[0].title).toBe('Cache eviction rule');
  });

  it('explicit - title: metadata wins over heading suffix', () => {
    const md = `## Summary

Test.

## Stop 1 — Heading title

- importance: primary
- title: Metadata title

A short narrative.

### Artifact: a.ts

- hunk: 1-5
`;
    const w = parseWalkthrough(md);
    expect(w.stops[0].title).toBe('Metadata title');
  });

  it('error messages name the specific stop', () => {
    const md = `## Summary

Test.

## Stop 1

- importance: primary
- title: First

Narrative.

### Artifact: a.ts

- hunk: 1-5

## Stop 2

- importance: bogus
- title: Second

Narrative.

### Artifact: b.ts

- hunk: 1-5
`;
    expect(() => parseWalkthrough(md)).toThrow(/Stop 2.*bogus/);
  });

  it('error message on missing hunks names the stop and file', () => {
    const md = `## Summary

Test.

## Stop 1

- importance: primary
- title: First

Narrative.

### Artifact: a.ts

- banner: no hunks here
`;
    expect(() => parseWalkthrough(md)).toThrow(/Stop 1.*a\.ts.*hunk/);
  });
});
