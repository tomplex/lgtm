import { describe, it, expect, beforeEach } from 'vitest';
import { setFiles } from '../state';
import { linesForArtifact } from '../components/walkthrough/lines-for-artifact';
import { parseDiff } from '../diff';
import type { StopArtifact } from '../walkthrough-types';

const DIFF = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -10,5 +10,7 @@
 line10
 line11
-line12
+line12new
+line13new
 line14
 line15
@@ -100,4 +102,4 @@
 line100
-line101
+line101new
 line102
 line103
`;

describe('linesForArtifact', () => {
  beforeEach(() => {
    setFiles(parseDiff(DIFF));
  });

  it('returns lines from the hunk overlapping the artifact range', () => {
    const a: StopArtifact = {
      file: 'a.ts',
      hunks: [{ newStart: 10, newLines: 7 }],
    };
    const indexed = linesForArtifact(a);
    const types = indexed.map((x) => x.line.type);
    const contents = indexed.map((x) => x.line.content);
    expect(types).toContain('hunk');
    expect(contents).toContain('line12new');
    expect(contents).toContain('line12');
    expect(contents).not.toContain('line101new');
  });

  it('includes deletions and hunk headers from matched hunks', () => {
    const a: StopArtifact = {
      file: 'a.ts',
      hunks: [{ newStart: 10, newLines: 7 }],
    };
    const indexed = linesForArtifact(a);
    expect(indexed.filter((x) => x.line.type === 'hunk')).toHaveLength(1);
    expect(indexed.filter((x) => x.line.type === 'del').length).toBeGreaterThan(0);
  });

  it('matches multiple hunks when artifact spans them', () => {
    const a: StopArtifact = {
      file: 'a.ts',
      hunks: [
        { newStart: 10, newLines: 7 },
        { newStart: 100, newLines: 6 },
      ],
    };
    const indexed = linesForArtifact(a);
    expect(indexed.filter((x) => x.line.type === 'hunk')).toHaveLength(2);
    expect(indexed.some((x) => x.line.content === 'line101new')).toBe(true);
  });

  it('forgives a range slightly past the actual hunk edges', () => {
    const a: StopArtifact = {
      file: 'a.ts',
      hunks: [{ newStart: 5, newLines: 30 }],
    };
    const indexed = linesForArtifact(a);
    expect(indexed.some((x) => x.line.content === 'line12new')).toBe(true);
  });

  it('falls back to all hunks when range matches nothing', () => {
    const a: StopArtifact = {
      file: 'a.ts',
      hunks: [{ newStart: 1000, newLines: 5 }],
    };
    const indexed = linesForArtifact(a);
    expect(indexed.some((x) => x.line.type === 'hunk')).toBe(true);
    expect(indexed.length).toBeGreaterThan(0);
  });

  it('returns empty array when file is not in the diff', () => {
    const a: StopArtifact = {
      file: 'nonexistent.ts',
      hunks: [{ newStart: 1, newLines: 5 }],
    };
    expect(linesForArtifact(a)).toEqual([]);
  });

  it('lineIdx values are absolute indices into the file lines array', () => {
    const a: StopArtifact = {
      file: 'a.ts',
      hunks: [{ newStart: 10, newLines: 7 }],
    };
    const indexed = linesForArtifact(a);
    expect(indexed[0].lineIdx).toBe(0);
    for (let i = 1; i < indexed.length; i++) {
      expect(indexed[i].lineIdx).toBeGreaterThan(indexed[i - 1].lineIdx);
    }
  });
});
