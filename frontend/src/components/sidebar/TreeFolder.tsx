import { Show, createMemo, createEffect } from 'solid-js';
import type { FolderNode, FileNode } from '../../tree';
import {
  activeRowId,
  setActiveRowId,
  collapsedFolders,
  setCollapsedFolders,
  toggleFolderCollapsed,
  dismissFolder,
  reviewedFiles,
} from '../../state';

interface Props {
  node: FolderNode;
}

function collectFiles(node: FolderNode, out: FileNode[]): void {
  for (const child of node.children) {
    if (child.kind === 'file') out.push(child);
    else collectFiles(child, out);
  }
}

export default function TreeFolder(props: Props) {
  const isActive = () => activeRowId() === props.node.id;
  const isSynthPhaseRoot = () => props.node.fullPath.endsWith(':__root__');
  const collapsed = () => !!collapsedFolders[props.node.fullPath];

  const descendants = createMemo(() => {
    const out: FileNode[] = [];
    collectFiles(props.node, out);
    return out;
  });

  const total = () => descendants().length;
  const reviewedCount = () => descendants().filter((f) => reviewedFiles[f.file.path]).length;
  const allReviewed = () => total() > 0 && reviewedCount() === total();

  // One-shot auto-collapse: when this folder flips to "all reviewed", collapse it.
  // If the user re-opens it, `wasAllReviewed` stays true so we don't keep re-collapsing.
  let wasAllReviewed = false;
  createEffect(() => {
    const done = allReviewed();
    if (done && !wasAllReviewed) {
      wasAllReviewed = true;
      if (!collapsedFolders[props.node.fullPath]) {
        setCollapsedFolders(props.node.fullPath, true);
      }
    }
    if (!done) wasAllReviewed = false;
  });

  function handleClick() {
    setActiveRowId(props.node.id);
    toggleFolderCollapsed(props.node.fullPath);
  }

  function handleDismiss(e: MouseEvent) {
    e.stopPropagation();
    dismissFolder(props.node.fullPath);
  }

  return (
    <div
      class={`folder-item${isActive() ? ' active' : ''}${allReviewed() ? ' all-reviewed' : ''}${isSynthPhaseRoot() ? ' phase-root' : ''}`}
      data-id={props.node.id}
      style={{ 'padding-left': `${props.node.depth * 12 + 4}px` }}
      role="treeitem"
      aria-level={props.node.depth + 1}
      aria-expanded={!collapsed()}
      aria-selected={isActive()}
      onClick={handleClick}
    >
      <span class="folder-chevron">{collapsed() ? '▸' : '▾'}</span>
      <span class="folder-name">{props.node.name}</span>
      <Show when={total() > 0}>
        <span class="folder-progress" aria-label={`${reviewedCount()} of ${total()} files reviewed`}>
          {reviewedCount()}/{total()}
        </span>
      </Show>
      <Show when={!isSynthPhaseRoot()}>
        <span class="folder-dismiss" title="Hide folder" onClick={handleDismiss}>
          &times;
        </span>
      </Show>
    </div>
  );
}
