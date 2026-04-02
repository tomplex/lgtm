import { For } from 'solid-js';
import { allCommits, selectedShas, setSelectedShas } from '../../state';

interface Props {
  visible: boolean;
  onApply: () => void;
}

export default function CommitPanel(props: Props) {
  function selectAll() {
    for (const c of allCommits()) setSelectedShas(c.sha, true);
  }

  function selectNone() {
    for (const c of allCommits()) setSelectedShas(c.sha, false);
  }

  return (
    <div class="commit-panel" classList={{ open: props.visible }}>
      <div class="commit-actions">
        <a onClick={selectAll}>Select all</a>
        <a onClick={selectNone}>Select none</a>
        <a onClick={props.onApply}>Apply</a>
      </div>
      <div class="commit-list">
        <For each={allCommits()}>
          {(c) => (
            <label class="commit-item">
              <input
                type="checkbox"
                checked={selectedShas[c.sha] ?? false}
                onChange={(e) => setSelectedShas(c.sha, e.currentTarget.checked)}
              />
              <span class="commit-sha">{c.sha.slice(0, 7)}</span>
              <span class="commit-msg" title={c.message}>
                {c.message}
              </span>
              <span class="commit-date">{c.date}</span>
            </label>
          )}
        </For>
      </div>
    </div>
  );
}
