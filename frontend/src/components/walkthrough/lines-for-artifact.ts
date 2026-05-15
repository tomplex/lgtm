import { files } from '../../state';
import type { DiffLine as DiffLineType } from '../../state';
import type { StopArtifact as Artifact } from '../../walkthrough-types';

export interface IndexedLine {
  line: DiffLineType;
  /** Absolute index in the file's lines array; used as DOM id by DiffLine. */
  lineIdx: number;
}

interface Group {
  lines: IndexedLine[];
  minNew: number;
  maxNew: number;
  hasDel: boolean;
  hasAdd: boolean;
}

/**
 * Pick the diff lines for an artifact, preserving each line's absolute index
 * within the file's lines array. Groups lines into hunks (split by
 * `type === 'hunk'`), picks each hunk whose new-side line span overlaps any of
 * the artifact's declared hunk ranges, and returns the indexed lines flattened.
 *
 * For a *modified* hunk (deletions interleaved with additions) the whole hunk
 * is kept — slicing it would hide deletions and break diff readability. But a
 * brand-new (or fully-deleted) file is a single huge hunk; keeping it whole
 * means every stop that references a different slice of that file renders the
 * entire file identically. So for a pure-add hunk we clip down to the declared
 * span (with a synthesized header) when the hunk is larger than what was asked.
 *
 * Overlap (vs strict containment) forgives agent line numbers that span a few
 * lines past the actual hunk edges.
 *
 * If nothing overlaps but the file has changes, falls back to all hunks rather
 * than rendering blank.
 */
export function linesForArtifact(a: Artifact): IndexedLine[] {
  const file = files().find((f) => f.path === a.file);
  if (!file) return [];

  const groups: Group[] = [];
  let cur: Group | null = null;
  for (let idx = 0; idx < file.lines.length; idx++) {
    const ln = file.lines[idx];
    if (ln.type === 'hunk') {
      cur = { lines: [{ line: ln, lineIdx: idx }], minNew: Infinity, maxNew: -Infinity, hasDel: false, hasAdd: false };
      groups.push(cur);
      continue;
    }
    if (!cur) {
      cur = { lines: [], minNew: Infinity, maxNew: -Infinity, hasDel: false, hasAdd: false };
      groups.push(cur);
    }
    cur.lines.push({ line: ln, lineIdx: idx });
    if (ln.type === 'del') cur.hasDel = true;
    if (ln.type === 'add') cur.hasAdd = true;
    if (ln.newLine != null) {
      if (ln.newLine < cur.minNew) cur.minNew = ln.newLine;
      if (ln.newLine > cur.maxNew) cur.maxNew = ln.newLine;
    }
  }

  // Declared span across all of the artifact's hunk ranges.
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of a.hunks) {
    if (h.newStart < lo) lo = h.newStart;
    const end = h.newStart + h.newLines - 1;
    if (end > hi) hi = end;
  }
  const haveSpan = lo !== Infinity && hi >= lo;

  const matched = groups.filter((g) => {
    if (g.maxNew === -Infinity) return false;
    return a.hunks.some((h) => {
      const hEnd = h.newStart + h.newLines - 1;
      return g.maxNew >= h.newStart && g.minNew <= hEnd;
    });
  });

  const out = matched.length > 0 ? matched : groups;
  return out.flatMap((g) => clipGroup(g, haveSpan, lo, hi));
}

/**
 * For a pure-add hunk that's bigger than the declared span, keep only the lines
 * inside `[lo, hi]` and replace the (now-misleading) hunk header with a synthetic
 * one. Modified hunks (any deletions) and hunks already within the span pass
 * through untouched.
 */
function clipGroup(g: Group, haveSpan: boolean, lo: number, hi: number): IndexedLine[] {
  const extendsBeyond = g.minNew < lo || g.maxNew > hi;
  if (!haveSpan || g.hasDel || !g.hasAdd || !extendsBeyond) return g.lines;

  const kept = g.lines.filter(
    ({ line }) => line.type !== 'hunk' && line.newLine != null && line.newLine >= lo && line.newLine <= hi,
  );
  if (kept.length === 0) return g.lines;

  const headerIdx = g.lines.find(({ line }) => line.type === 'hunk')?.lineIdx;
  const start = kept[0].line.newLine!;
  const end = kept[kept.length - 1].line.newLine!;
  const header: IndexedLine = {
    line: { type: 'hunk', content: `@@ lines ${start}–${end} @@`, oldLine: null, newLine: null },
    lineIdx: headerIdx ?? kept[0].lineIdx - 1,
  };
  return [header, ...kept];
}
