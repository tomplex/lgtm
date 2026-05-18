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
  walkthroughMode,
  setWalkthroughMode,
  walkthrough,
  activeStopIdx,
  setActiveStopIdx,
  walkthroughCursor,
  setWalkthroughCursor,
  setCommentTrigger,
} from '../state';
import { collectFiles } from '../tree';
import { nextRow, prevRow, nextFolder, prevFolder, folderOf } from './useKeyboardShortcuts-helpers';
import {
  nextRow as cursorNextRow,
  prevRow as cursorPrevRow,
  firstRow as cursorFirstRow,
  lastRow as cursorLastRow,
  jumpRows as cursorJumpRows,
  type ArtifactLines,
  type Cursor,
} from './walkthrough-cursor-helpers';
import { linesForArtifact } from '../components/walkthrough/lines-for-artifact';

interface Options {
  onRefresh: () => void;
  onToggleCommits: () => void;
  onJumpComment: (direction: 'next' | 'prev') => void;
  onSymbolSearch: () => void;
  onOpenPalette: () => void;
  onOpenHelp: () => void;
}

function currentStopArtifacts(): ArtifactLines[] {
  const w = walkthrough();
  if (!w) return [];
  const stop = w.stops[activeStopIdx()];
  if (!stop) return [];
  return stop.artifacts.map((a) => {
    const lines = linesForArtifact(a);
    return {
      rows: lines.map((l) => ({
        focusable: l.line.type !== 'hunk',
        lineIdx: l.lineIdx,
      })),
    };
  });
}

function estimateViewportRows(): number {
  const body = document.querySelector('.wt-body') as HTMLElement | null;
  if (!body) return 20;
  const rowHeight = 20; // matches .diff-table line-height in style.css
  return Math.max(1, Math.floor(body.clientHeight / rowHeight));
}

export function useKeyboardShortcuts(options: Options) {
  let lastShiftUp = 0;
  let shiftDownClean = false;
  let _pendingJump = false;
  let _pendingJumpTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPendingJump() {
    _pendingJump = false;
    if (_pendingJumpTimer) {
      clearTimeout(_pendingJumpTimer);
      _pendingJumpTimer = null;
    }
  }

  function armPendingJump() {
    _pendingJump = true;
    if (_pendingJumpTimer) clearTimeout(_pendingJumpTimer);
    _pendingJumpTimer = setTimeout(clearPendingJump, 500);
  }

  function ensureCursor(arts: ArtifactLines[]): Cursor | null {
    const c = walkthroughCursor();
    if (c) return c;
    const f = cursorFirstRow(arts);
    if (f) setWalkthroughCursor(f);
    return f;
  }

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
    // Keep the active row visible in the sidebar as you page through it with j/k.
    requestAnimationFrame(() => {
      const el = document.querySelector(`#file-tree [data-id="${CSS.escape(nextId)}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  function handler(e: KeyboardEvent) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      options.onOpenPalette();
      return;
    }

    if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      options.onOpenHelp();
      return;
    }

    // --- Walkthrough-mode keys ---
    if (walkthroughMode()) {
      const w = walkthrough();
      const len = w?.stops.length ?? 0;
      if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        setWalkthroughMode(false);
        clearPendingJump();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        setActiveStopIdx(Math.min(activeStopIdx() + 1, Math.max(0, len - 1)));
        clearPendingJump();
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        setActiveStopIdx(Math.max(activeStopIdx() - 1, 0));
        clearPendingJump();
        return;
      }
      // g + digit → jump to stop N (existing behaviour, kept ahead of `gg`).
      if (_pendingJump && /^[0-9]$/.test(e.key)) {
        const target = parseInt(e.key, 10) - 1;
        if (target >= 0 && target < len) setActiveStopIdx(target);
        clearPendingJump();
        return;
      }
      // g then g → first focusable row of stop.
      if (_pendingJump && e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        const arts = currentStopArtifacts();
        const f = cursorFirstRow(arts);
        if (f) setWalkthroughCursor(f);
        clearPendingJump();
        return;
      }
      if (e.key === 'g' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        armPendingJump();
        return;
      }

      // Vim line navigation.
      if (e.key === 'j' && !e.metaKey && !e.ctrlKey) {
        const arts = currentStopArtifacts();
        const cur = ensureCursor(arts);
        if (cur && walkthroughCursor()) {
          const n = cursorNextRow(arts, cur);
          if (n) setWalkthroughCursor(n);
        }
        clearPendingJump();
        return;
      }
      if (e.key === 'k' && !e.metaKey && !e.ctrlKey) {
        const arts = currentStopArtifacts();
        const cur = ensureCursor(arts);
        if (cur && walkthroughCursor()) {
          const n = cursorPrevRow(arts, cur);
          if (n) setWalkthroughCursor(n);
        }
        clearPendingJump();
        return;
      }
      if (e.key === 'd' && e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const arts = currentStopArtifacts();
        const cur = ensureCursor(arts);
        if (cur) {
          const half = Math.max(1, Math.floor(estimateViewportRows() / 2));
          setWalkthroughCursor(cursorJumpRows(arts, cur, half));
        }
        clearPendingJump();
        return;
      }
      if (e.key === 'u' && e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const arts = currentStopArtifacts();
        const cur = ensureCursor(arts);
        if (cur) {
          const half = Math.max(1, Math.floor(estimateViewportRows() / 2));
          setWalkthroughCursor(cursorJumpRows(arts, cur, -half));
        }
        clearPendingJump();
        return;
      }
      if (e.key === 'G' && !e.metaKey && !e.ctrlKey) {
        const arts = currentStopArtifacts();
        const l = cursorLastRow(arts);
        if (l) setWalkthroughCursor(l);
        clearPendingJump();
        return;
      }
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
        const arts = currentStopArtifacts();
        const cur = ensureCursor(arts);
        if (cur) {
          const stop = walkthrough()?.stops[activeStopIdx()];
          const art = stop?.artifacts[cur.artifactIdx];
          const row = arts[cur.artifactIdx]?.rows[cur.rowIdx];
          if (art && row) setCommentTrigger({ file: art.file, lineIdx: row.lineIdx });
        }
        clearPendingJump();
        return;
      }
      clearPendingJump();
      return;
    }

    // --- Entering walkthrough from diff mode ---
    if (e.key === 'W' && !e.metaKey && !e.ctrlKey && walkthrough()) {
      setWalkthroughMode(true);
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
