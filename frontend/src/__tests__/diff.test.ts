import { describe, it, expect } from 'vitest';
import { parseDiff } from '../diff';

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,5 +1,6 @@
 import { bar } from './bar';

-const old = true;
+const new1 = true;
+const new2 = false;

 export default bar;
`;

describe('parseDiff', () => {
  it('parses a simple diff into files', () => {
    const files = parseDiff(SAMPLE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/foo.ts');
  });

  it('counts additions and deletions', () => {
    const files = parseDiff(SAMPLE_DIFF);
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
  });

  it('parses line types correctly', () => {
    const files = parseDiff(SAMPLE_DIFF);
    const lines = files[0].lines;
    const types = lines.map((l) => l.type);
    expect(types).toEqual(['hunk', 'context', 'context', 'del', 'add', 'add', 'context', 'context', 'context']);
  });

  it('assigns line numbers', () => {
    const files = parseDiff(SAMPLE_DIFF);
    const lines = files[0].lines;
    // First context line: old=1, new=1
    expect(lines[1].oldLine).toBe(1);
    expect(lines[1].newLine).toBe(1);
    // Deleted line: old=3, new=null
    expect(lines[3].oldLine).toBe(3);
    expect(lines[3].newLine).toBeNull();
    // First added line: old=null, new=3
    expect(lines[4].oldLine).toBeNull();
    expect(lines[4].newLine).toBe(3);
  });

  it('handles empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('handles multiple files', () => {
    const multi = SAMPLE_DIFF + `diff --git a/src/bar.ts b/src/bar.ts
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1,3 +1,3 @@
-export const bar = 1;
+export const bar = 2;
`;
    const files = parseDiff(multi);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('src/foo.ts');
    expect(files[1].path).toBe('src/bar.ts');
  });

  it('handles deleted files', () => {
    const deleted = `diff --git a/old.ts b/old.ts
--- a/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const x = 1;
-const y = 2;
`;
    const files = parseDiff(deleted);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('old.ts (deleted)');
    expect(files[0].deletions).toBe(2);
  });
});
