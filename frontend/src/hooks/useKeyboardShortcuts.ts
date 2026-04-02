import { onMount, onCleanup } from 'solid-js';
import {
  appMode,
  files,
  activeFileIdx,
  setActiveFileIdx,
  setWholeFileView,
  toggleWholeFileView,
  allCommits,
  toggleReviewed,
} from '../state';

interface Options {
  onRefresh: () => void;
  onToggleCommits: () => void;
  onJumpComment: (direction: 'next' | 'prev') => void;
}

export function useKeyboardShortcuts(options: Options) {
  function getAdjacentFileIdx(direction: 'next' | 'prev'): number | null {
    const items = Array.from(document.querySelectorAll<HTMLElement>('.file-item:not(.hidden)'));
    const currentPos = items.findIndex((el) => parseInt(el.dataset.idx!) === activeFileIdx());
    const targetPos = direction === 'next' ? currentPos + 1 : currentPos - 1;
    if (targetPos < 0 || targetPos >= items.length) return null;
    return parseInt(items[targetPos].dataset.idx!);
  }

  function handler(e: KeyboardEvent) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

    if (e.key === 'j' || e.key === 'ArrowDown') {
      const nextIdx = getAdjacentFileIdx('next');
      if (nextIdx !== null) {
        setActiveFileIdx(nextIdx);
        setWholeFileView(false);
        window.location.hash = 'file=' + encodeURIComponent(files()[nextIdx].path);
      }
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      const prevIdx = getAdjacentFileIdx('prev');
      if (prevIdx !== null) {
        setActiveFileIdx(prevIdx);
        setWholeFileView(false);
        window.location.hash = 'file=' + encodeURIComponent(files()[prevIdx].path);
      }
    } else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
      options.onRefresh();
    } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      (window as any).__focusFileSearch?.();
    } else if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
      if (allCommits().length > 0) options.onToggleCommits();
    } else if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
      const file = files()[activeFileIdx()];
      if (file) toggleReviewed(file.path);
    } else if (e.key === 'w' && !e.metaKey && !e.ctrlKey) {
      if (appMode() === 'diff' && files()[activeFileIdx()]) {
        toggleWholeFileView();
      }
    } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
      options.onJumpComment('next');
    } else if (e.key === 'p' && !e.metaKey && !e.ctrlKey) {
      options.onJumpComment('prev');
    }
  }

  onMount(() => document.addEventListener('keydown', handler));
  onCleanup(() => document.removeEventListener('keydown', handler));
}
