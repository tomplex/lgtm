import { Show, For } from 'solid-js';
import { analysis, sidebarView, setSidebarView } from '../../state';
import type { SidebarView } from '../../state';

const VIEWS: { id: SidebarView; label: string }[] = [
  { id: 'flat', label: 'Flat' },
  { id: 'grouped', label: 'Grouped' },
  { id: 'phased', label: 'Phased' },
];

export default function ViewToggle() {
  return (
    <Show when={analysis()}>
      <div class="view-toggle" id="view-toggle">
        <For each={VIEWS}>
          {(view) => (
            <button
              class="view-btn"
              classList={{ active: sidebarView() === view.id }}
              data-view={view.id}
              onClick={() => setSidebarView(view.id)}
            >
              {view.label}
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
