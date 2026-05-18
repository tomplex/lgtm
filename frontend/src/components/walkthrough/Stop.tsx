// frontend/src/components/walkthrough/Stop.tsx
import { createEffect, For } from 'solid-js';
import { walkthrough, activeStopIdx, walkthroughCursor } from '../../state';
import { StopArtifact } from './StopArtifact';

export function Stop() {
  const current = () => walkthrough()?.stops[activeStopIdx()] ?? null;

  // Scroll the focused line into view when the cursor moves. Defer to a
  // microtask so the DOM has the new wt-line-focus class. block: 'nearest'
  // avoids scrolling when the row is already visible, so manual scroll
  // between keypresses doesn't get yanked.
  createEffect(() => {
    const c = walkthroughCursor();
    if (!c) return;
    queueMicrotask(() => {
      const el = document.querySelector('.wt-line-focus') as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
  });

  return (
    <main class="wt-stop">
      {current() && (
        <>
          <div class="wt-stop-label">
            Stop {current()!.order} · <span class={`wt-imp-${current()!.importance}`}>{current()!.importance}</span>
          </div>
          <h2 class="wt-stop-title">{current()!.title}</h2>
          <p class="wt-stop-narrative">{current()!.narrative}</p>
          <For each={current()!.artifacts}>{(a, i) => <StopArtifact artifact={a} artifactIdx={i()} />}</For>
        </>
      )}
    </main>
  );
}
