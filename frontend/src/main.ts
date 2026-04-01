import 'highlight.js/styles/github-dark.css';
import './style.css';

import { fetchItemData, fetchAnalysis, baseUrl } from './api';
import { applyHash } from './diff';
import { escapeHtml } from './utils';
import { activeItemId, setAnalysis } from './state';
import { showToast } from './utils';
import { loadState } from './persistence';
import {
  loadItems,
  switchToItem,
  refreshDiff,
  handleSubmitReview,
  toggleCommitPanel,
  setupKeyboardShortcuts,
  setupResizableSidebar,
  setupFileSearch,
  setupViewToggle,
} from './ui';

async function init(): Promise<void> {
  await loadState();
  // One-time migration from localStorage
  const legacyKey = 'lgtm-review-state';
  const legacy = localStorage.getItem(legacyKey);
  if (legacy) {
    localStorage.removeItem(legacyKey);
  }
  try {
    await loadItems();

    const analysisData = await fetchAnalysis();
    if (analysisData) setAnalysis(analysisData);

    // Set page title from first load
    const data = await fetchItemData('diff');
    if (data.mode === 'diff' && data.meta) {
      const repo = data.meta.repoName || 'Review';
      const branch = data.meta.branch || '';
      const base = data.meta.baseBranch || 'main';
      document.title = `${repo} — ${branch}`;
      const h1 = document.querySelector('h1')!;
      let headerHtml = `<strong>${escapeHtml(repo)}</strong> <span class="header-branch">${escapeHtml(branch)} → ${escapeHtml(base)}</span>`;
      if (data.meta.pr) {
        headerHtml += ` <a class="header-pr" href="${escapeHtml(data.meta.pr.url)}" target="_blank">PR #${data.meta.pr.number}</a>`;
      }
      h1.innerHTML = headerHtml;
    }

    // Load the default item (diff)
    await switchToItem('diff');
  } catch (e: any) {
    document.getElementById('diff-container')!.innerHTML =
      `<div class="empty-state">Error: ${escapeHtml(e.message)}</div>`;
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
setupViewToggle();

// SSE — auto-reload on server events
function connectSSE(): void {
  const eventsUrl = `${baseUrl()}/events`;
  const es = new EventSource(eventsUrl);
  es.addEventListener('comments_changed', () => {
    switchToItem(activeItemId);
    showToast('New comments from Claude', 2000);
  });
  es.addEventListener('items_changed', () => {
    loadItems().then(() => showToast('Review items updated', 2000));
  });
  es.onerror = () => {
    es.close();
    setTimeout(connectSSE, 5000);
  };
}
connectSSE();

// Go
init();
