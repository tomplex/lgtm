import { Show, createMemo } from 'solid-js';
import type { FileNode } from '../../tree';
import {
  activeRowId,
  setActiveRowId,
  setWholeFileView,
  comments,
  reviewedFiles,
  toggleReviewed,
  analysis,
  dismissFile,
  walkthrough,
  stopsByFile,
  setActiveStopIdx,
  setWalkthroughMode,
} from '../../state';

interface Props {
  node: FileNode;
}

export default function TreeFile(props: Props) {
  const isActive = () => activeRowId() === props.node.id;
  const path = () => props.node.file.path;
  const isReviewed = () => reviewedFiles[path()] ?? false;

  const fileComments = createMemo(() =>
    comments.list.filter((c) => c.file === path() && !c.parentId && c.status !== 'dismissed'),
  );
  const userCount = () => fileComments().filter((c) => c.author === 'user').length;
  const claudeCount = () => fileComments().filter((c) => c.author === 'claude').length;

  const lastSlash = () => path().lastIndexOf('/');
  const base = () => (lastSlash() >= 0 ? path().slice(lastSlash() + 1) : path());
  const priority = () => analysis()?.files[path()]?.priority;

  function handleSelect() {
    setActiveRowId(props.node.id);
    setWholeFileView(false);
    window.location.hash = 'file=' + encodeURIComponent(path());
  }

  return (
    <div
      class={`file-item${isActive() ? ' active' : ''}${isReviewed() ? ' reviewed' : ''}${priority() ? ` priority-${priority()}` : ''}`}
      data-id={props.node.id}
      style={{ 'padding-left': `${props.node.depth * 12 + 8}px` }}
      role="treeitem"
      aria-level={props.node.depth + 1}
      aria-selected={isActive()}
      onClick={handleSelect}
    >
      <span
        class="review-check"
        title="Mark as reviewed (e)"
        onClick={(e) => {
          e.stopPropagation();
          toggleReviewed(path());
        }}
      >
        {isReviewed() ? '✓' : '○'}
      </span>
      <span class="filename" title={path()}>
        <span class="base">{base()}</span>
      </span>
      <Show when={claudeCount() > 0}>
        <span class="badge claude-badge" title="Claude comments">
          {claudeCount()}
        </span>
      </Show>
      <Show when={userCount() > 0}>
        <span class="badge comments-badge" title="Your comments">
          {userCount()}
        </span>
      </Show>
      <Show when={stopsByFile()[path()]?.length}>
        {(count) => (
          <span
            class="wt-file-badge"
            title={`Walkthrough stop${count() > 1 ? 's' : ''} ${stopsByFile()[path()].join(', ')}`}
            onClick={(e) => {
              e.stopPropagation();
              const ids = stopsByFile()[path()];
              const w = walkthrough();
              if (!w || !ids.length) return;
              const idx = w.stops.findIndex(s => s.order === ids[0]);
              if (idx >= 0) setActiveStopIdx(idx);
              setWalkthroughMode(true);
            }}
          >
            ◆{stopsByFile()[path()].join(',')}
          </span>
        )}
      </Show>
      <span class="file-stats">
        <span class="add">+{props.node.file.additions}</span>
        <span class="del">-{props.node.file.deletions}</span>
      </span>
      <span
        class="file-dismiss"
        title="Hide file"
        onClick={(e) => {
          e.stopPropagation();
          dismissFile(path());
        }}
      >
        &times;
      </span>
    </div>
  );
}
