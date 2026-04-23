// frontend/src/components/walkthrough/StopArtifact.tsx
import { For, Show } from 'solid-js';
import { files } from '../../state';
import type { StopArtifact as Artifact } from '../../walkthrough-types';

/** Pick the lines of `files()[path]` whose newLine is in any of the artifact's hunk ranges. */
function linesForArtifact(a: Artifact) {
  const file = files().find((f) => f.path === a.file);
  if (!file) return [];
  return file.lines.filter((ln) => {
    if (ln.newLine == null) return false;
    return a.hunks.some((h) => ln.newLine! >= h.newStart && ln.newLine! < h.newStart + h.newLines);
  });
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
              <span class="wt-line-num">{ln.newLine ?? ''}</span>
              <span class="wt-line-content">{ln.content}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
