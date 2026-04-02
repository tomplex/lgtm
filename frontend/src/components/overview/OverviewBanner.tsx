import { Show, createSignal } from 'solid-js';
import { analysis } from '../../state';

export default function OverviewBanner() {
  const [collapsed, setCollapsed] = createSignal(localStorage.getItem('lgtm-overview-collapsed') === 'true');

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
              <div class="overview-label">Overview</div>
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
