import { Show } from 'solid-js';
import {
  analysis,
  sortMode,
  setSortMode,
  groupMode,
  setGroupMode,
  setGroupModeUserTouched,
} from '../../state';

export default function SortGroupControls() {
  function pickSort(mode: 'path' | 'priority') {
    setSortMode(mode);
  }
  function pickGroup(mode: 'none' | 'phase') {
    setGroupMode(mode);
    setGroupModeUserTouched(true);
  }

  return (
    <Show when={analysis()}>
      <div class="sort-group-controls">
        <div class="chip-row">
          <span class="chip-label">Sort:</span>
          <button
            class="chip"
            classList={{ on: sortMode() === 'path' }}
            onClick={() => pickSort('path')}
          >
            Path
          </button>
          <button
            class="chip"
            classList={{ on: sortMode() === 'priority' }}
            onClick={() => pickSort('priority')}
          >
            Priority
          </button>
        </div>
        <div class="chip-row">
          <span class="chip-label">Group by:</span>
          <button
            class="chip"
            classList={{ on: groupMode() === 'none' }}
            onClick={() => pickGroup('none')}
          >
            None
          </button>
          <button
            class="chip"
            classList={{ on: groupMode() === 'phase' }}
            onClick={() => pickGroup('phase')}
          >
            Phase
          </button>
        </div>
      </div>
    </Show>
  );
}
