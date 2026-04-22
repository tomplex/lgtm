import { For, Show } from 'solid-js';
import { visibleRows, files, dismissedFiles, dismissedFolders, undismissAll, filterQuery } from '../../state';
import TreeFile from './TreeFile';
import TreeFolder from './TreeFolder';

export default function FileTree() {
  const hasAnyDismissed = () =>
    Object.values(dismissedFiles).some(Boolean) || Object.values(dismissedFolders).some(Boolean);

  const dismissedTotal = () =>
    Object.values(dismissedFiles).filter(Boolean).length + Object.values(dismissedFolders).filter(Boolean).length;

  const hasFiles = () => files().length > 0;
  const rowsExist = () => visibleRows().length > 0;
  const filtering = () => filterQuery().trim().length > 0;

  return (
    <div class="file-tree" id="file-tree" role="tree">
      <Show when={hasAnyDismissed()}>
        <div class="dismissed-notice">
          <a onClick={undismissAll}>
            {dismissedTotal()} hidden item{dismissedTotal() !== 1 ? 's' : ''} — show all
          </a>
        </div>
      </Show>
      <For each={visibleRows()}>
        {(row) => (row.kind === 'file' ? <TreeFile node={row} /> : <TreeFolder node={row} />)}
      </For>
      <Show when={hasFiles() && !rowsExist() && filtering()}>
        <div class="tree-empty">No matches</div>
      </Show>
    </div>
  );
}
