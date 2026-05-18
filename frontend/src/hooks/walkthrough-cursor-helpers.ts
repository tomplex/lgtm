/**
 * Pure-logic helpers for the walkthrough line cursor. The hook handler is
 * tested via the dev server; only these helpers carry non-trivial logic, so
 * they live in their own file alongside `useKeyboardShortcuts-helpers.ts`.
 */

export interface CursorRow {
  /** True if this row is a real source line (skippable when false: hunk markers). */
  focusable: boolean;
  /** The absolute lineIdx of the row inside its file — used as DOM id elsewhere. */
  lineIdx: number;
}

export interface ArtifactLines {
  rows: CursorRow[];
}

export interface Cursor {
  artifactIdx: number;
  rowIdx: number;
}

export function firstRow(stop: ArtifactLines[]): Cursor | null {
  for (let a = 0; a < stop.length; a++) {
    for (let r = 0; r < stop[a].rows.length; r++) {
      if (stop[a].rows[r].focusable) return { artifactIdx: a, rowIdx: r };
    }
  }
  return null;
}

export function lastRow(stop: ArtifactLines[]): Cursor | null {
  for (let a = stop.length - 1; a >= 0; a--) {
    for (let r = stop[a].rows.length - 1; r >= 0; r--) {
      if (stop[a].rows[r].focusable) return { artifactIdx: a, rowIdx: r };
    }
  }
  return null;
}

export function nextRow(stop: ArtifactLines[], cur: Cursor): Cursor | null {
  let a = cur.artifactIdx;
  let r = cur.rowIdx + 1;
  while (a < stop.length) {
    const rows = stop[a].rows;
    while (r < rows.length) {
      if (rows[r].focusable) return { artifactIdx: a, rowIdx: r };
      r++;
    }
    a++;
    r = 0;
  }
  return null;
}

export function prevRow(stop: ArtifactLines[], cur: Cursor): Cursor | null {
  let a = cur.artifactIdx;
  let r = cur.rowIdx - 1;
  while (a >= 0) {
    const rows = stop[a].rows;
    while (r >= 0) {
      if (rows[r].focusable) return { artifactIdx: a, rowIdx: r };
      r--;
    }
    a--;
    r = a >= 0 ? stop[a].rows.length - 1 : -1;
  }
  return null;
}

export function jumpRows(stop: ArtifactLines[], cur: Cursor, delta: number): Cursor {
  if (delta === 0) return cur;
  const step = delta > 0 ? nextRow : prevRow;
  let c: Cursor = cur;
  let remaining = Math.abs(delta);
  while (remaining > 0) {
    const n = step(stop, c);
    if (!n) break;
    c = n;
    remaining--;
  }
  return c;
}
