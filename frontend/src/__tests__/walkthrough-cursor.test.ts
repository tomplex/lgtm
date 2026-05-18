import { describe, it, expect } from 'vitest';
import { nextRow, prevRow, firstRow, lastRow, jumpRows, type ArtifactLines } from '../hooks/walkthrough-cursor-helpers';

// Build a fixture stop from arrays of "focusable?" booleans, one array per artifact.
function stop(...artifacts: boolean[][]): ArtifactLines[] {
  return artifacts.map((rows) => ({
    rows: rows.map((focusable, idx) => ({ focusable, lineIdx: idx * 100 })),
  }));
}

describe('walkthrough cursor helpers', () => {
  it('firstRow returns {0,0} when first artifact has focusable rows', () => {
    expect(firstRow(stop([true, true], [true]))).toEqual({ artifactIdx: 0, rowIdx: 0 });
  });

  it('firstRow skips artifacts with no focusable rows', () => {
    expect(firstRow(stop([false], [true]))).toEqual({ artifactIdx: 1, rowIdx: 0 });
  });

  it('firstRow returns null when nothing is focusable', () => {
    expect(firstRow(stop([false], [false]))).toBeNull();
  });

  it('lastRow returns the last focusable position across artifacts', () => {
    expect(lastRow(stop([true, true], [true, false, true]))).toEqual({ artifactIdx: 1, rowIdx: 2 });
  });

  it('nextRow advances within an artifact', () => {
    expect(nextRow(stop([true, true, true]), { artifactIdx: 0, rowIdx: 0 })).toEqual({
      artifactIdx: 0,
      rowIdx: 1,
    });
  });

  it('nextRow rolls over to the next artifact', () => {
    expect(nextRow(stop([true, true], [true]), { artifactIdx: 0, rowIdx: 1 })).toEqual({
      artifactIdx: 1,
      rowIdx: 0,
    });
  });

  it('nextRow skips hunk-header rows', () => {
    expect(nextRow(stop([true, false, true]), { artifactIdx: 0, rowIdx: 0 })).toEqual({
      artifactIdx: 0,
      rowIdx: 2,
    });
  });

  it('nextRow returns null at end of stop', () => {
    expect(nextRow(stop([true, true]), { artifactIdx: 0, rowIdx: 1 })).toBeNull();
  });

  it('prevRow goes back within artifact', () => {
    expect(prevRow(stop([true, true]), { artifactIdx: 0, rowIdx: 1 })).toEqual({
      artifactIdx: 0,
      rowIdx: 0,
    });
  });

  it('prevRow rolls back to previous artifact', () => {
    expect(prevRow(stop([true, true], [true]), { artifactIdx: 1, rowIdx: 0 })).toEqual({
      artifactIdx: 0,
      rowIdx: 1,
    });
  });

  it('prevRow returns null at start of stop', () => {
    expect(prevRow(stop([true, true]), { artifactIdx: 0, rowIdx: 0 })).toBeNull();
  });

  it('jumpRows(+n) advances n focusable rows, clamping at end', () => {
    const s = stop([true, true], [true, true, true]);
    expect(jumpRows(s, { artifactIdx: 0, rowIdx: 0 }, 3)).toEqual({ artifactIdx: 1, rowIdx: 1 });
    expect(jumpRows(s, { artifactIdx: 0, rowIdx: 0 }, 999)).toEqual({ artifactIdx: 1, rowIdx: 2 });
  });

  it('jumpRows(-n) retreats n focusable rows, clamping at start', () => {
    const s = stop([true, true], [true, true]);
    expect(jumpRows(s, { artifactIdx: 1, rowIdx: 1 }, -2)).toEqual({ artifactIdx: 0, rowIdx: 1 });
    expect(jumpRows(s, { artifactIdx: 1, rowIdx: 1 }, -999)).toEqual({ artifactIdx: 0, rowIdx: 0 });
  });

  it('jumpRows ignores hunk-header rows when counting', () => {
    expect(jumpRows(stop([true, false, true, true]), { artifactIdx: 0, rowIdx: 0 }, 1)).toEqual({
      artifactIdx: 0,
      rowIdx: 2,
    });
  });
});
