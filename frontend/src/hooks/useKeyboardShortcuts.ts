import { onMount, onCleanup } from 'solid-js';
import {
  appMode,
  activeFile,
  files,
  activeFileIdx,
  setActiveFileIdx,
  setWholeFileView,
  allCommits,
  toggleReviewed,
  toggleWholeFileView,
} from '../state';

interface Options {
  onRefresh: () => void;
  onToggleCommits: () => void;
  onJumpComment: (direction: 'next' | 'prev') => void;
  onSymbolSearch: () => void;
  onOpenPalette: () => void;
}

export function useKeyboardShortcuts(options: Options) {
  function getAdjacentFileIdx(direction: 'next' | 'prev'): number | null {
    const items = Array.from(document.querySelectorAll<HTMLElement>('.file-item:not(.hidden)'));
    const currentPos = items.findIndex((el) => parseInt(el.dataset.idx!) === activeFileIdx());
    const targetPos = direction === 'next' ? currentPos + 1 : currentPos - 1;
    if (targetPos < 0 || targetPos >= items.length) return null;
    return parseInt(items[targetPos].dataset.idx!);
  }

  let lastShiftUp = 0;
  let shiftDownClean = false;

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Shift') {
      shiftDownClean = true;
    } else {
      shiftDownClean = false;
    }
  }

  function onShiftUp(e: KeyboardEvent) {
    if (e.key !== 'Shift') return;
    if (!shiftDownClean) return;
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

    const now = Date.now();
    if (now - lastShiftUp < 300) {
      lastShiftUp = 0;
      options.onSymbolSearch();
    } else {
      lastShiftUp = now;
    }
  }

  function handler(e: KeyboardEvent) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      options.onOpenPalette();
      return;
    }

    if (e.key === 'j' || e.key === 'ArrowDown') {
      const nextIdx = getAdjacentFileIdx('next');
      if (nextIdx !== null) {
        setActiveFileIdx(nextIdx);
        setWholeFileView(false);
        window.location.hash = 'file=' + encodeURIComponent(files()[nextIdx].path);
      }
    } else if ((e.key === 'k' || e.key === 'ArrowUp') && !e.metaKey && !e.ctrlKey) {
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
      const f = activeFile();
      if (f) toggleReviewed(f.path);
    } else if (e.key === 'w' && !e.metaKey && !e.ctrlKey) {
      if (appMode() === 'diff' && activeFile()) toggleWholeFileView();
    } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
      options.onJumpComment('next');
    } else if (e.key === 'p' && !e.metaKey && !e.ctrlKey) {
      options.onJumpComment('prev');
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handler);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onShiftUp);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', handler);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onShiftUp);
  });
}
