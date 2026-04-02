import { reviewedFiles, sidebarView } from './state';
import type { SidebarView } from './state';
import { setSidebarView } from './state';
import { baseUrl, fetchUserState, putUserReviewed, putUserSidebarView } from './api';

let lastReviewedFiles = new Set<string>();
let lastSidebarView = '';

export async function loadState(): Promise<void> {
  try {
    const state = await fetchUserState();

    if (state.reviewedFiles) {
      for (const path of state.reviewedFiles) {
        reviewedFiles.add(path);
      }
    }

    if (state.sidebarView && ['flat', 'grouped', 'phased'].includes(state.sidebarView)) {
      setSidebarView(state.sidebarView as SidebarView);
    }

    lastReviewedFiles = new Set(reviewedFiles);
    lastSidebarView = sidebarView;
  } catch {
    /* server unavailable — start fresh */
  }
}

export function saveState(): void {
  for (const path of reviewedFiles) {
    if (!lastReviewedFiles.has(path)) putUserReviewed(path);
  }
  for (const path of lastReviewedFiles) {
    if (!reviewedFiles.has(path)) putUserReviewed(path);
  }
  lastReviewedFiles = new Set(reviewedFiles);

  if (sidebarView !== lastSidebarView) {
    putUserSidebarView(sidebarView);
    lastSidebarView = sidebarView;
  }
}

export async function clearPersistedState(): Promise<void> {
  lastReviewedFiles = new Set();
  await fetch(`${baseUrl()}/user-state/clear`, { method: 'POST' });
}
