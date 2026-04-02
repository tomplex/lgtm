import { reviewedFiles, setReviewedFiles, sidebarView, setSidebarView } from './state';
import type { SidebarView } from './state';
import { fetchUserState, putUserReviewed, putUserSidebarView } from './api';

let lastReviewedSnapshot: Record<string, boolean> = {};
let lastSidebarView = '';

export async function loadState(): Promise<void> {
  try {
    const state = await fetchUserState();

    if (state.reviewedFiles) {
      for (const path of state.reviewedFiles) {
        setReviewedFiles(path, true);
      }
    }

    if (state.sidebarView && ['flat', 'grouped', 'phased'].includes(state.sidebarView)) {
      setSidebarView(state.sidebarView as SidebarView);
    }

    lastReviewedSnapshot = { ...reviewedFiles };
    lastSidebarView = sidebarView();
  } catch {
    /* server unavailable — start fresh */
  }
}

export function saveState(): void {
  // Sync reviewed files
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

  if (sidebarView() !== lastSidebarView) {
    putUserSidebarView(sidebarView());
    lastSidebarView = sidebarView();
  }
}

export async function clearPersistedState(): Promise<void> {
  lastReviewedSnapshot = {};
  const { baseUrl } = await import('./api');
  await fetch(`${baseUrl()}/user-state/clear`, { method: 'POST' });
}
