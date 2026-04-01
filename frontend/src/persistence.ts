import { comments, reviewedFiles, resolvedComments } from './state';

const STORAGE_KEY = 'lgtm-review-state';

interface PersistedState {
  comments: Record<string, string>;
  reviewedFiles: string[];
  resolvedComments: string[];
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveState(): void {
  // Debounce — coalesce rapid mutations into one write
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const state: PersistedState = {
      comments: { ...comments },
      reviewedFiles: Array.from(reviewedFiles),
      resolvedComments: Array.from(resolvedComments),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* storage full or unavailable */ }
  }, 100);
}

export function loadState(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const state: PersistedState = JSON.parse(raw);

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
  } catch { /* corrupt or unavailable */ }
}

export function clearPersistedState(): void {
  localStorage.removeItem(STORAGE_KEY);
}
