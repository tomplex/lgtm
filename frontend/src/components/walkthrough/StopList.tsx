// frontend/src/components/walkthrough/StopList.tsx
import { For } from 'solid-js';
import { walkthrough, activeStopIdx, setActiveStopIdx, visitedStops, markStopVisited } from '../../state';

export function StopList() {
  return (
    <aside class="wt-stops">
      <div class="wt-stops-header">Stops</div>
      <For each={walkthrough()?.stops ?? []}>
        {(stop, i) => (
          <div
            class="wt-stop-row"
            classList={{
              'wt-stop-active': i() === activeStopIdx(),
              'wt-stop-visited': !!visitedStops[stop.id] && i() !== activeStopIdx(),
            }}
            onClick={() => { setActiveStopIdx(i()); markStopVisited(stop.id); }}
          >
            <span class="wt-stop-bullet">
              {visitedStops[stop.id] ? '✓' : i() === activeStopIdx() ? '●' : '○'}
            </span>
            <div class="wt-stop-row-body">
              <div class="wt-stop-row-title">{stop.order} · {stop.title}</div>
              <div class="wt-stop-row-files">
                {stop.artifacts.map(a => a.file.split('/').pop()).join(' · ')}
              </div>
            </div>
          </div>
        )}
      </For>
    </aside>
  );
}
