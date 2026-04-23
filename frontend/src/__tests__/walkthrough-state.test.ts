import { describe, it, expect, beforeEach } from 'vitest';
import {
  walkthrough, setWalkthrough, walkthroughStale, setWalkthroughStale,
  walkthroughMode, setWalkthroughMode, activeStopIdx, setActiveStopIdx,
  visitedStops, markStopVisited,
} from '../state';
import type { Walkthrough } from '../walkthrough-types';

const W: Walkthrough = {
  summary: 's',
  diffHash: 'h',
  generatedAt: '2026-04-23T00:00:00Z',
  stops: [
    { id: 'stop-1', order: 1, title: 'A', narrative: 'na', importance: 'primary',
      artifacts: [{ file: 'a.ts', hunks: [{ newStart: 1, newLines: 3 }] }] },
    { id: 'stop-2', order: 2, title: 'B', narrative: 'nb', importance: 'supporting',
      artifacts: [{ file: 'b.ts', hunks: [{ newStart: 1, newLines: 3 }] }] },
  ],
};

describe('walkthrough state', () => {
  beforeEach(() => {
    setWalkthrough(null);
    setWalkthroughStale(false);
    setWalkthroughMode(false);
    setActiveStopIdx(0);
  });

  it('defaults', () => {
    expect(walkthrough()).toBeNull();
    expect(walkthroughStale()).toBe(false);
    expect(walkthroughMode()).toBe(false);
    expect(activeStopIdx()).toBe(0);
    expect(Object.keys(visitedStops)).toHaveLength(0);
  });

  it('stores walkthrough', () => {
    setWalkthrough(W);
    expect(walkthrough()).toEqual(W);
  });

  it('markStopVisited adds to set', () => {
    markStopVisited('stop-1');
    expect(visitedStops['stop-1']).toBe(true);
  });
});
