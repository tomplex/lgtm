// frontend/src/components/walkthrough/WalkthroughView.tsx
import { Show } from 'solid-js';
import { walkthrough, walkthroughStale, activeStopIdx, setWalkthroughMode } from '../../state';
import { StopList } from './StopList';
import { Stop } from './Stop';
import { StaleBanner } from './StaleBanner';
import { EmptyState } from './EmptyState';

export function WalkthroughView() {
  const total = () => walkthrough()?.stops.length ?? 0;
  const pct = () => {
    const t = total();
    return t === 0 ? 0 : Math.round(((activeStopIdx() + 1) / t) * 100);
  };
  return (
    <div class="wt-view">
      <div class="wt-topbar">
        <button class="wt-back" onClick={() => setWalkthroughMode(false)}>
          ← Back to diff
        </button>
        <div class="wt-title">{walkthrough()?.summary.split('.')[0] ?? 'Walkthrough'}</div>
        <div class="wt-progress">
          <Show when={total() > 0} fallback={<span>—</span>}>
            Stop {activeStopIdx() + 1} of {total()} · {pct()}%
          </Show>
        </div>
      </div>
      <Show when={walkthroughStale()}>
        <StaleBanner />
      </Show>
      <div class="wt-body">
        <Show when={walkthrough()} fallback={<EmptyState />}>
          <StopList />
          <Stop />
        </Show>
      </div>
    </div>
  );
}
