import { createEffect } from 'solid-js';
import {
  reviewedFiles,
  setReviewedFiles,
  sortMode,
  setSortMode,
  groupMode,
  setGroupMode,
  groupModeUserTouched,
  setGroupModeUserTouched,
  collapsedFolders,
  setCollapsedFolders,
  analysis,
} from './state';
import { fetchUserState, putUserReviewed, putUserSidebarPrefs, type SidebarPrefs } from './api';

let lastReviewedSnapshot: Record<string, boolean> = {};
let lastPrefsSnapshot: SidebarPrefs = {
  sortMode: 'path',
  groupMode: 'none',
  groupModeUserTouched: false,
  collapsedFolders: {},
};

export async function loadState(): Promise<void> {
  try {
    const state = await fetchUserState();

    if (Array.isArray(state.reviewedFiles)) {
      for (const path of state.reviewedFiles) {
        setReviewedFiles(path, true);
      }
    }

    if (state.sortMode === 'path' || state.sortMode === 'priority') {
      setSortMode(state.sortMode);
    }
    if (state.groupMode === 'none' || state.groupMode === 'phase') {
      setGroupMode(state.groupMode);
    }
    if (typeof state.groupModeUserTouched === 'boolean') {
      setGroupModeUserTouched(state.groupModeUserTouched);
    }
    if (state.collapsedFolders && typeof state.collapsedFolders === 'object') {
      for (const [path, collapsed] of Object.entries(state.collapsedFolders)) {
        if (collapsed) setCollapsedFolders(path, true);
      }
    }

    // Analysis-driven default promotion: if analysis is present and user hasn't
    // touched groupMode, promote to 'phase'. Done after load so persisted values win.
    if (analysis() && !groupModeUserTouched() && groupMode() === 'none') {
      setGroupMode('phase');
    }

    lastReviewedSnapshot = { ...reviewedFiles };
    lastPrefsSnapshot = snapshotPrefs();
  } catch {
    /* server unavailable — start fresh */
  }
}

function snapshotPrefs(): SidebarPrefs {
  return {
    sortMode: sortMode(),
    groupMode: groupMode(),
    groupModeUserTouched: groupModeUserTouched(),
    collapsedFolders: { ...collapsedFolders },
  };
}

export function saveState(): void {
  // Reviewed files diff
  for (const path of Object.keys(reviewedFiles)) {
    if (reviewedFiles[path] && !lastReviewedSnapshot[path]) {
      putUserReviewed(path);
    }
  }
  for (const path of Object.keys(lastReviewedSnapshot)) {
    if (lastReviewedSnapshot[path] && !reviewedFiles[path]) {
      putUserReviewed(path);
    }
  }
  lastReviewedSnapshot = { ...reviewedFiles };

  // Prefs diff — send each field that changed.
  const next = snapshotPrefs();
  const changed: Partial<SidebarPrefs> = {};
  if (next.sortMode !== lastPrefsSnapshot.sortMode) changed.sortMode = next.sortMode;
  if (next.groupMode !== lastPrefsSnapshot.groupMode) changed.groupMode = next.groupMode;
  if (next.groupModeUserTouched !== lastPrefsSnapshot.groupModeUserTouched) {
    changed.groupModeUserTouched = next.groupModeUserTouched;
  }
  if (!shallowEqual(next.collapsedFolders, lastPrefsSnapshot.collapsedFolders)) {
    changed.collapsedFolders = next.collapsedFolders;
  }
  if (Object.keys(changed).length > 0) {
    putUserSidebarPrefs(changed);
    lastPrefsSnapshot = next;
  }
}

function shallowEqual(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

export async function clearPersistedState(): Promise<void> {
  lastReviewedSnapshot = {};
  const { baseUrl } = await import('./api');
  await fetch(`${baseUrl()}/user-state/clear`, { method: 'POST' });
}

export function watchAndSave(): void {
  createEffect(() => {
    // Subscribe to signals; saveState will no-op if nothing changed.
    sortMode();
    groupMode();
    groupModeUserTouched();
    // Access the store reactively by listing entries (triggers proxy tracking).
    Object.keys(collapsedFolders);
    Object.values(collapsedFolders);
    saveState();
  });
}
