import { onMount, onCleanup } from 'solid-js';
import {
  appMode,
  activeFile,
  activeRowId,
  setActiveRowId,
  setWholeFileView,
  toggleWholeFileView,
  allCommits,
  toggleReviewed,
  reviewedFiles,
  setReviewedFiles,
  visibleRows,
  collapsedFolders,
  setCollapsedFolders,
  toggleFolderCollapsed,
} from '../state';
import { collectFiles } from '../tree';
import { nextRow, prevRow, nextFolder, prevFolder, folderOf } from './useKeyboardShortcuts-helpers';

interface Options {
  onRefresh: () => void;
  onToggleCommits: () => void;
  onJumpComment: (direction: 'next' | 'prev') => void;
  onSymbolSearch: () => void;
  onOpenPalette: () => void;
}

export function useKeyboardShortcuts(options: Options) {
  let lastShiftUp = 0;
  let shiftDownClean = false;

  function onKeyDown(e: KeyboardEvent) {
    shiftDownClean = e.key === 'Shift';
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

  function moveTo(nextId: string | null) {
    if (!nextId) return;
    setActiveRowId(nextId);
    const rows = visibleRows();
    const row = rows.find((r) => r.id === nextId);
    if (row?.kind === 'file') {
      setWholeFileView(false);
      window.location.hash = 'file=' + encodeURIComponent(row.file.path);
    }
  }

  function handler(e: KeyboardEvent) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      options.onOpenPalette();
      return;
    }

    const rows = visibleRows();
    const cur = activeRowId();

    if (e.key === 'j' || e.key === 'ArrowDown') {
      moveTo(nextRow(rows, cur));
    } else if ((e.key === 'k' || e.key === 'ArrowUp') && !e.metaKey && !e.ctrlKey) {
      moveTo(prevRow(rows, cur));
    } else if (e.key === 'h' || e.key === 'ArrowLeft') {
      const row = rows.find((r) => r.id === cur);
      if (!row) return;
      if (row.kind === 'folder') {
        setCollapsedFolders(row.fullPath, true);
      } else {
        moveTo(folderOf(rows, cur));
      }
    } else if (e.key === 'l' || e.key === 'ArrowRight') {
      const row = rows.find((r) => r.id === cur);
      if (!row || row.kind !== 'folder') return;
      if (collapsedFolders[row.fullPath]) {
        setCollapsedFolders(row.fullPath, false);
      } else {
        // Move to first child (after expand it's the row right after this one).
        const newRows = visibleRows();
        const idx = newRows.findIndex((r) => r.id === row.id);
        const child = newRows[idx + 1];
        if (child && child.depth > row.depth) moveTo(child.id);
      }
    } else if (e.key === '[') {
      moveTo(prevFolder(rows, cur));
    } else if (e.key === ']') {
      moveTo(nextFolder(rows, cur));
    } else if (e.key === 'o' && !e.metaKey && !e.ctrlKey) {
      const parent = folderOf(rows, cur);
      if (parent) {
        const folderRow = rows.find((r) => r.id === parent);
        if (folderRow?.kind === 'folder') toggleFolderCollapsed(folderRow.fullPath);
      }
    } else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
      options.onRefresh();
    } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      (window as any).__focusFileSearch?.();
    } else if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
      if (allCommits().length > 0) options.onToggleCommits();
    } else if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
      const cur = activeRowId();
      const row = cur ? visibleRows().find((r) => r.id === cur) : undefined;
      if (!row) return;
      if (row.kind === 'file') {
        toggleReviewed(row.file.path);
      } else {
        const descendants = collectFiles(row);
        if (descendants.length === 0) return;
        const allReviewed = descendants.every((f) => reviewedFiles[f.file.path]);
        const target = !allReviewed;
        for (const f of descendants) {
          if ((reviewedFiles[f.file.path] ?? false) !== target) {
            setReviewedFiles(f.file.path, target);
          }
        }
      }
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
