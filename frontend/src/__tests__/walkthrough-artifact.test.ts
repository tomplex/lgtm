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

const NEW_FILE_DIFF = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0..1
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,10 @@
+l1
+l2
+l3
+l4
+l5
+l6
+l7
+l8
+l9
+l10
`;

describe('linesForArtifact — new-file hunk slicing', () => {
  beforeEach(() => {
    setFiles(parseDiff(NEW_FILE_DIFF));
  });

  it('clips a pure-add hunk to the declared span', () => {
    const a: StopArtifact = { file: 'new.ts', hunks: [{ newStart: 3, newLines: 3 }] };
    const indexed = linesForArtifact(a);
    const contents = indexed.filter((x) => x.line.type === 'add').map((x) => x.line.content);
    expect(contents).toEqual(['l3', 'l4', 'l5']);
  });

  it('synthesizes a header reflecting the slice', () => {
    const a: StopArtifact = { file: 'new.ts', hunks: [{ newStart: 3, newLines: 3 }] };
    const indexed = linesForArtifact(a);
    const hunks = indexed.filter((x) => x.line.type === 'hunk');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].line.content).toBe('@@ lines 3–5 @@');
  });

  it('non-overlapping declared sub-ranges yield disjoint slices', () => {
    const first = linesForArtifact({ file: 'new.ts', hunks: [{ newStart: 1, newLines: 4 }] });
    const second = linesForArtifact({ file: 'new.ts', hunks: [{ newStart: 6, newLines: 5 }] });
    const c1 = first.filter((x) => x.line.type === 'add').map((x) => x.line.content);
    const c2 = second.filter((x) => x.line.type === 'add').map((x) => x.line.content);
    expect(c1).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(c2).toEqual(['l6', 'l7', 'l8', 'l9', 'l10']);
  });

  it('keeps the whole hunk (original header) when the declared span already covers it', () => {
    const a: StopArtifact = { file: 'new.ts', hunks: [{ newStart: 1, newLines: 20 }] };
    const indexed = linesForArtifact(a);
    expect(indexed.filter((x) => x.line.type === 'add')).toHaveLength(10);
    expect(indexed.find((x) => x.line.type === 'hunk')!.line.content).toBe('@@ -0,0 +1,10 @@');
  });
});
