import { Show, createSignal, createMemo } from 'solid-js';
import { analysis, analysisFreshness } from '../../state';

export default function OverviewBanner() {
  const [collapsed, setCollapsed] = createSignal(localStorage.getItem('lgtm-overview-collapsed') === 'true');

  const staleCount = createMemo(() => {
    const f = analysisFreshness();
    if (!f) return 0;
    return f.staleFiles.length + f.missingFiles.length + f.removedFiles.length;
  });

  function toggle() {
    const next = !collapsed();
    setCollapsed(next);
    localStorage.setItem('lgtm-overview-collapsed', String(next));
  }

  return (
    <Show when={analysis()}>
      {(a) => (
        <div class="overview-banner" classList={{ collapsed: collapsed() }}>
          <div class="overview-content">
            <div class="overview-section">
              <div class="overview-label">
                Overview
                <Show when={staleCount() > 0}>
                  <span
                    class="stale-chip"
                    title="Some file diffs have changed since the last analysis. Click 'Refresh' in the header to update."
                  >
                    {staleCount()} stale
                  </span>
                </Show>
              </div>
              <div class="overview-text">{a().overview}</div>
            </div>
            <div class="overview-section">
              <div class="overview-label">Review Strategy</div>
              <div class="overview-strategy">{a().reviewStrategy}</div>
            </div>
          </div>
          <button class="overview-toggle" title="Toggle overview" onClick={toggle}>
            &#9650;
          </button>
        </div>
      )}
    </Show>
  );
}
