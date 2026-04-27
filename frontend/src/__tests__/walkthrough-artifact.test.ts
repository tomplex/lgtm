import { describe, it, expect, beforeEach } from 'vitest';
import { setFiles } from '../state';
import { linesForArtifact } from '../components/walkthrough/StopArtifact';
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
    const lines = linesForArtifact(a);
    expect(lines.some((l) => l.type === 'hunk')).toBe(true);
    expect(lines.some((l) => l.type === 'add' && l.content === 'line12new')).toBe(true);
    expect(lines.some((l) => l.type === 'del' && l.content === 'line12')).toBe(true);
    expect(lines.some((l) => l.type === 'add' && l.content === 'line101new')).toBe(false);
  });

  it('includes deletions and hunk headers from matched hunks', () => {
    const a: StopArtifact = {
      file: 'a.ts',
      hunks: [{ newStart: 10, newLines: 7 }],
    };
    const lines = linesForArtifact(a);
    const hunkHeaders = lines.filter((l) => l.type === 'hunk');
    const dels = lines.filter((l) => l.type === 'del');
    expect(hunkHeaders).toHaveLength(1);
    expect(dels.length).toBeGreaterThan(0);
  });

  it('matches multiple hunks when artifact spans them', () => {
    const a: StopArtifact = {
      file: 'a.ts',
      hunks: [
        { newStart: 10, newLines: 7 },
        { newStart: 100, newLines: 6 },
      ],
    };
    const lines = linesForArtifact(a);
    expect(lines.filter((l) => l.type === 'hunk')).toHaveLength(2);
    expect(lines.some((l) => l.type === 'add' && l.content === 'line101new')).toBe(true);
  });

  it('forgives a range slightly past the actual hunk edges', () => {
    const a: StopArtifact = {
      file: 'a.ts',
      hunks: [{ newStart: 5, newLines: 30 }], // wider than the actual hunk
    };
    const lines = linesForArtifact(a);
    expect(lines.some((l) => l.type === 'add' && l.content === 'line12new')).toBe(true);
  });

  it('falls back to all hunks when range matches nothing', () => {
    const a: StopArtifact = {
      file: 'a.ts',
      hunks: [{ newStart: 1000, newLines: 5 }],
    };
    const lines = linesForArtifact(a);
    expect(lines.some((l) => l.type === 'hunk')).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('returns empty array when file is not in the diff', () => {
    const a: StopArtifact = {
      file: 'nonexistent.ts',
      hunks: [{ newStart: 1, newLines: 5 }],
    };
    expect(linesForArtifact(a)).toEqual([]);
  });
});
