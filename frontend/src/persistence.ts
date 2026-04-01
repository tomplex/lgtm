import { comments, reviewedFiles, resolvedComments, sidebarView } from './state';
import type { SidebarView } from './state';
import { setSidebarView } from './state';
import {
  fetchUserState,
  putUserComment,
  putUserReviewed,
  putUserResolved,
  putUserSidebarView,
  clearUserState,
} from './api';

// Track keys to detect additions and deletions
let lastCommentKeys = new Set<string>();
let lastReviewedFiles = new Set<string>();
let lastResolvedComments = new Set<string>();
let lastSidebarView = '';

export async function loadState(): Promise<void> {
  try {
    const state = await fetchUserState();

    if (state.comments) {
      for (const [key, value] of Object.entries(state.comments)) {
        comments[key] = value;
      }
    }

    if (state.reviewedFiles) {
      for (const path of state.reviewedFiles) {
        reviewedFiles.add(path);
      }
    }

    if (state.resolvedComments) {
      for (const key of state.resolvedComments) {
        resolvedComments.add(key);
      }
    }

    if (state.sidebarView && ['flat', 'grouped', 'phased'].includes(state.sidebarView)) {
      setSidebarView(state.sidebarView as SidebarView);
    }

    // Snapshot current state for diffing
    lastCommentKeys = new Set(Object.keys(comments));
    lastReviewedFiles = new Set(reviewedFiles);
    lastResolvedComments = new Set(resolvedComments);
    lastSidebarView = sidebarView;
  } catch {
    /* server unavailable — start fresh */
  }
}

export function saveState(): void {
  // Send full current state to server. All endpoints are idempotent
  // and the server is localhost, so redundant writes are cheap.

  // Comments: sync all keys
  const currentKeys = new Set(Object.keys(comments));
  for (const key of currentKeys) {
    putUserComment(key, comments[key]);
  }
  for (const key of lastCommentKeys) {
    if (!currentKeys.has(key)) putUserComment(key, null);
  }
  lastCommentKeys = new Set(currentKeys);

  // Reviewed files: toggle any that changed
  for (const path of reviewedFiles) {
    if (!lastReviewedFiles.has(path)) putUserReviewed(path);
  }
  for (const path of lastReviewedFiles) {
    if (!reviewedFiles.has(path)) putUserReviewed(path);
  }
  lastReviewedFiles = new Set(reviewedFiles);

  // Resolved comments: toggle any that changed
  for (const key of resolvedComments) {
    if (!lastResolvedComments.has(key)) putUserResolved(key);
  }
  for (const key of lastResolvedComments) {
    if (!resolvedComments.has(key)) putUserResolved(key);
  }
  lastResolvedComments = new Set(resolvedComments);

  // Sidebar view
  if (sidebarView !== lastSidebarView) {
    putUserSidebarView(sidebarView);
    lastSidebarView = sidebarView;
  }
}

export async function clearPersistedState(): Promise<void> {
  lastCommentKeys = new Set();
  lastReviewedFiles = new Set();
  lastResolvedComments = new Set();
  await clearUserState();
}
