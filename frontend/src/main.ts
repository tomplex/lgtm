import 'highlight.js/styles/github-dark.css';
import './style.css';

import { fetchItemData } from './api';
import { applyHash } from './diff';
import { escapeHtml } from './utils';
import {
  loadItems, switchToItem, refreshDiff, handleSubmitReview,
  toggleCommitPanel, setupKeyboardShortcuts, setupResizableSidebar, setupFileSearch,
} from './ui';

async function init(): Promise<void> {
  try {
    await loadItems();

    // Set page title from first load
    const data = await fetchItemData('diff');
    if (data.mode === 'diff') {
      const branch = data.meta?.branch || 'Review';
      document.title = `Review: ${branch}`;
      document.querySelector('h1')!.textContent = `Review: ${branch}`;
    }

    // Load the default item (diff)
    await switchToItem('diff');
  } catch (e: any) {
    document.getElementById('diff-container')!.innerHTML = `<div class="empty-state">Error: ${escapeHtml(e.message)}</div>`;
  }
}

// Wire up header buttons
document.getElementById('commit-toggle-btn')!.addEventListener('click', toggleCommitPanel);
document.getElementById('refresh-btn')!.addEventListener('click', refreshDiff);
document.getElementById('submit-btn')!.addEventListener('click', handleSubmitReview);

// Hash-based navigation
window.addEventListener('hashchange', () => applyHash(window.location.hash));

// Setup
setupKeyboardShortcuts();
setupResizableSidebar();
setupFileSearch();

// Go
init();
