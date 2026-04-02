import { createSignal, createResource, For, Show, onMount, onCleanup } from 'solid-js';
import { fetchRepoFiles } from '../../api';
import { sessionItems } from '../../state';

interface Props {
  onClose: () => void;
  onSelect: (filepath: string) => void;
}

export default function FilePicker(props: Props) {
  let inputRef!: HTMLInputElement;
  let pickerRef!: HTMLDivElement;
  const [query, setQuery] = createSignal('');

  const [allFiles] = createResource(async () => {
    try {
      return await fetchRepoFiles('**/*.md');
    } catch {
      return [];
    }
  });

  const existingPaths = () => new Set(sessionItems().filter((i) => i.path).map((i) => i.path));

  const filtered = () => {
    const q = query().toLowerCase();
    const files = allFiles() || [];
    return files
      .filter((f) => !existingPaths().has(f) && (!q || f.toLowerCase().includes(q)))
      .slice(0, 20);
  };

  function handleClickOutside(e: Event) {
    if (pickerRef && !pickerRef.contains(e.target as Node)) {
      props.onClose();
    }
  }

  onMount(() => {
    inputRef.focus();
    setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
  });

  onCleanup(() => document.removeEventListener('click', handleClickOutside));

  return (
    <div id="file-picker" ref={pickerRef}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Filter files..."
        autocomplete="off"
        onInput={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose();
          if (e.key === 'Enter') {
            const first = filtered()[0];
            if (first) props.onSelect(first);
          }
        }}
      />
      <div id="file-picker-list">
        <Show when={filtered().length === 0}>
          <div class="file-picker-empty">No matching files</div>
        </Show>
        <For each={filtered()}>
          {(file) => (
            <div class="file-picker-row" onClick={() => props.onSelect(file)}>
              {file}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
