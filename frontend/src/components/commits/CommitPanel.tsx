import { For, Show, createMemo, createSignal } from 'solid-js';
import { allCommits, selectedShas, setSelectedShas } from '../../state';

interface Props {
  visible: boolean;
  onApply: () => void;
}

export default function CommitPanel(props: Props) {
  const [filter, setFilter] = createSignal('');

  const shown = createMemo(() => {
    const q = filter().trim().toLowerCase();
    if (!q) return allCommits();
    return allCommits().filter((c) => `${c.sha} ${c.message} ${c.author} ${c.date}`.toLowerCase().includes(q));
  });

  function selectAll() {
    for (const c of shown()) setSelectedShas(c.sha, true);
  }

  function selectNone() {
    for (const c of shown()) setSelectedShas(c.sha, false);
  }

  return (
    <div class="commit-panel" classList={{ open: props.visible }}>
      <div class="commit-actions">
        <input
          class="commit-filter"
          type="text"
          placeholder="Filter commits…"
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
        />
        <a onClick={selectAll}>Select all</a>
        <a onClick={selectNone}>Select none</a>
        <a onClick={props.onApply}>Apply</a>
      </div>
      <div class="commit-list">
        <For each={shown()}>
          {(c) => (
            <label class="commit-item">
              <input
                type="checkbox"
                checked={selectedShas[c.sha] ?? false}
                onChange={(e) => setSelectedShas(c.sha, e.currentTarget.checked)}
              />
              <span class="commit-sha">{c.sha.slice(0, 7)}</span>
              <span class="commit-date">{c.date}</span>
              <span class="commit-msg" title={c.message}>
                {c.message}
              </span>
            </label>
          )}
        </For>
        <Show when={shown().length === 0}>
          <div class="commit-empty">No matching commits</div>
        </Show>
      </div>
    </div>
  );
}
