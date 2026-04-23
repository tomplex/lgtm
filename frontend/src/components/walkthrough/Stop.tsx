// frontend/src/components/walkthrough/Stop.tsx
import { For } from 'solid-js';
import { walkthrough, activeStopIdx } from '../../state';
import { StopArtifact } from './StopArtifact';

export function Stop() {
  const current = () => walkthrough()?.stops[activeStopIdx()] ?? null;
  return (
    <main class="wt-stop">
      {current() && (
        <>
          <div class="wt-stop-label">
            Stop {current()!.order} · <span class={`wt-imp-${current()!.importance}`}>{current()!.importance}</span>
          </div>
          <h2 class="wt-stop-title">{current()!.title}</h2>
          <p class="wt-stop-narrative">{current()!.narrative}</p>
          <For each={current()!.artifacts}>{(a) => <StopArtifact artifact={a} />}</For>
        </>
      )}
    </main>
  );
}
