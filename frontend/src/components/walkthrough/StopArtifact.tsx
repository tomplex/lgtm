// frontend/src/components/walkthrough/StopArtifact.tsx
import { For, Show } from 'solid-js';
import { files } from '../../state';
import type { DiffLine } from '../../state';
import type { StopArtifact as Artifact } from '../../walkthrough-types';

/**
 * Pick the diff lines for an artifact. Groups the file's lines into hunks
 * (split by `type === 'hunk'` headers), then picks each whole hunk whose
 * new-side line span overlaps any of the artifact's declared hunk ranges.
 *
 * Whole-hunk inclusion (vs filtering individual lines) preserves diff
 * readability — you see deletions and hunk headers, not just add/context.
 *
 * Overlap (vs strict containment) forgives agent line numbers that span
 * a few lines of breathing room past the actual hunk edges.
 *
 * If nothing overlaps but the file does have changes, we fall back to
 * showing the whole file's diff. That's better than rendering blank when
 * the agent's range is off.
 */
export function linesForArtifact(a: Artifact): DiffLine[] {
  const file = files().find((f) => f.path === a.file);
  if (!file) return [];

  interface Group {
    lines: DiffLine[];
    minNew: number;
    maxNew: number;
  }
  const groups: Group[] = [];
  let cur: Group | null = null;
  for (const ln of file.lines) {
    if (ln.type === 'hunk') {
      cur = { lines: [ln], minNew: Infinity, maxNew: -Infinity };
      groups.push(cur);
      continue;
    }
    if (!cur) {
      cur = { lines: [], minNew: Infinity, maxNew: -Infinity };
      groups.push(cur);
    }
    cur.lines.push(ln);
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

export function StopArtifact(props: { artifact: Artifact }) {
  return (
    <div class="wt-artifact">
      <Show when={props.artifact.banner}>
        <div class="wt-banner">{props.artifact.banner}</div>
      </Show>
      <div class="wt-artifact-header">{props.artifact.file}</div>
      <div class="wt-artifact-lines">
        <For each={linesForArtifact(props.artifact)}>
          {(ln) => (
            <div class={`wt-line wt-line-${ln.type}`}>
              <span class="wt-line-num">{ln.newLine ?? ln.oldLine ?? ''}</span>
              <span class="wt-line-content">{ln.content}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
