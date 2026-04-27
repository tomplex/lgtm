import { files } from '../../state';
import type { DiffLine as DiffLineType } from '../../state';
import type { StopArtifact as Artifact } from '../../walkthrough-types';

export interface IndexedLine {
  line: DiffLineType;
  /** Absolute index in the file's lines array; used as DOM id by DiffLine. */
  lineIdx: number;
}

/**
 * Pick the diff lines for an artifact, preserving each line's absolute index
 * within the file's lines array. Groups lines into hunks (split by
 * `type === 'hunk'`), picks each whole hunk whose new-side line span overlaps
 * any of the artifact's declared hunk ranges, and returns the indexed lines
 * flattened.
 *
 * Whole-hunk inclusion (vs filtering individual lines) preserves diff
 * readability — you see deletions and hunk headers, not just add/context.
 *
 * Overlap (vs strict containment) forgives agent line numbers that span a
 * few lines past the actual hunk edges.
 *
 * If nothing overlaps but the file has changes, falls back to all hunks
 * rather than rendering blank.
 */
export function linesForArtifact(a: Artifact): IndexedLine[] {
  const file = files().find((f) => f.path === a.file);
  if (!file) return [];

  interface Group {
    lines: IndexedLine[];
    minNew: number;
    maxNew: number;
  }
  const groups: Group[] = [];
  let cur: Group | null = null;
  for (let idx = 0; idx < file.lines.length; idx++) {
    const ln = file.lines[idx];
    if (ln.type === 'hunk') {
      cur = { lines: [{ line: ln, lineIdx: idx }], minNew: Infinity, maxNew: -Infinity };
      groups.push(cur);
      continue;
    }
    if (!cur) {
      cur = { lines: [], minNew: Infinity, maxNew: -Infinity };
      groups.push(cur);
    }
    cur.lines.push({ line: ln, lineIdx: idx });
    if (ln.newLine != null) {
      if (ln.newLine < cur.minNew) cur.minNew = ln.newLine;
      if (ln.newLine > cur.maxNew) cur.maxNew = ln.newLine;
    }
  }

  const matched = groups.filter((g) => {
    if (g.maxNew === -Infinity) return false;
    return a.hunks.some((h) => {
      const hEnd = h.newStart + h.newLines - 1;
      return g.maxNew >= h.newStart && g.minNew <= hEnd;
    });
  });

  const out = matched.length > 0 ? matched : groups;
  return out.flatMap((g) => g.lines);
}
