import { Show, createMemo, createEffect } from 'solid-js';
import type { FolderNode } from '../../tree';
import { collectFiles } from '../../tree';
import {
  activeRowId,
  setActiveRowId,
  effectiveCollapsedFolders,
  setCollapsedFolders,
  setSessionCollapsedFolders,
  sessionCollapsedFolders,
  dismissFolder,
  reviewedFiles,
} from '../../state';

interface Props {
  node: FolderNode;
}

export default function TreeFolder(props: Props) {
  const isActive = () => activeRowId() === props.node.id;
  const isSynthPhaseRoot = () => props.node.fullPath.endsWith(':__root__');
  const collapsed = () => !!effectiveCollapsedFolders()[props.node.fullPath];

  const descendants = createMemo(() => collectFiles(props.node));

  const total = () => descendants().length;
  const reviewedCount = () => descendants().filter((f) => reviewedFiles[f.file.path]).length;
  const allReviewed = () => total() > 0 && reviewedCount() === total();

  // One-shot auto-collapse: when this folder flips to "all reviewed", collapse it via session overlay.
  // Not persisted. Clears when folder is no longer all-reviewed (e.g. user un-reviews a file).
  let wasAllReviewed = false;
  createEffect(() => {
    const done = allReviewed();
    if (done && !wasAllReviewed) {
      wasAllReviewed = true;
      setSessionCollapsedFolders(props.node.fullPath, true);
    }
    if (!done) {
      wasAllReviewed = false;
      if (sessionCollapsedFolders[props.node.fullPath] === true) {
        setSessionCollapsedFolders(props.node.fullPath, undefined!);
      }
    }
  });

  function handleClick() {
    setActiveRowId(props.node.id);
    // User-initiated: write to persisted store based on effective state, clear session overlay.
    setCollapsedFolders(props.node.fullPath, !effectiveCollapsedFolders()[props.node.fullPath]);
    setSessionCollapsedFolders(props.node.fullPath, undefined!);
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
