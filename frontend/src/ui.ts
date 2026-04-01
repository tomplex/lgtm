import {
  files,
  activeFileIdx,
  comments,
  claudeComments,
  sessionItems,
  activeItemId,
  repoMeta,
  allCommits,
  reviewedFiles,
  wholeFileView,
  analysis,
  appMode,
  setWholeFileView,
  setFiles,
  setRepoMeta,
  setClaudeComments,
  setSessionItems,
  setActiveItemId,
  setAppMode,
} from './state';
import { fetchItems, fetchItemData, submitReview as apiSubmitReview } from './api';
import { escapeHtml, showToast } from './utils';
import { parseDiff, renderDiff, selectFile, showWholeFile } from './diff';
import { renderMarkdown, renderMarkdownComments } from './document';
import { jumpToComment, formatAllComments } from './comments';
import { clearPersistedState } from './persistence';
import { renderFileList, renderViewToggle } from './file-list';
import { loadCommits, toggleCommitPanel } from './commit-picker';

// Re-export for external consumers
export { renderFileList, renderViewToggle, setupViewToggle, setupFileSearch } from './file-list';
export { toggleCommitPanel } from './commit-picker';

// --- Tabs ---

function renderTabs(): void {
  const bar = document.getElementById('tab-bar')!;
  bar.innerHTML = '';
  for (const item of sessionItems) {
    const tab = document.createElement('div');
    tab.className = 'tab-item' + (item.id === activeItemId ? ' active' : '');
    tab.dataset.id = item.id;

    let badges = '';
    const effUserCount =
      item.id === 'diff'
        ? Object.keys(comments).filter((k) => !k.startsWith('doc:')).length
        : Object.keys(comments).filter((k) => k.startsWith(`doc:${item.id}:`)).length;
    const claudeCount = claudeComments.filter((c) => c._item === item.id).length;

    if (claudeCount > 0) badges += `<span class="tab-badge claude">${claudeCount}</span>`;
    if (effUserCount > 0) badges += `<span class="tab-badge user">${effUserCount}</span>`;

    tab.innerHTML = `${escapeHtml(item.title)}${badges}`;
    tab.onclick = () => switchToItem(item.id);
    bar.appendChild(tab);
  }
}

// --- Item switching ---

export async function loadItems(): Promise<void> {
  try {
    const items = await fetchItems();
    setSessionItems(items);
    renderTabs();
  } catch {
    /* ignore */
  }
}

function setupDiffView(data: { diff: string; description: string; meta: any; claudeComments?: any[] }): void {
  document.querySelector<HTMLElement>('.sidebar')!.style.display = '';
  document.getElementById('resize-handle')!.style.display = '';
  document.querySelector('.keyboard-hint')!.innerHTML =
    'Click line to comment &middot; <kbd>Cmd+Enter</kbd> save &middot; <kbd>f</kbd> search (<code>!test *.py</code>) &middot; <kbd>w</kbd> whole file &middot; <kbd>e</kbd> reviewed &middot; <kbd>c</kbd> commits &middot; <kbd>n</kbd>/<kbd>p</kbd> next/prev comment';

  setRepoMeta(data.meta || {});
  setClaudeComments((data.claudeComments || []).map((c, i) => ({ ...c, _item: 'diff', _serverIndex: i })));
  setAppMode('diff');

  if (data.description) {
    const banner = document.getElementById('description-banner')!;
    banner.textContent = data.description;
    banner.style.display = '';
  } else {
    document.getElementById('description-banner')!.style.display = 'none';
  }

  if (repoMeta.branch) {
    const bar = document.getElementById('meta-bar')!;
    let metaHtml = `<span class="branch">${escapeHtml(repoMeta.branch)}</span>`;
    metaHtml += `<span>vs ${escapeHtml(repoMeta.baseBranch || 'master')}</span>`;
    if (repoMeta.repoPath) metaHtml += `<span>${escapeHtml(repoMeta.repoPath)}</span>`;
    if (repoMeta.pr) {
      metaHtml += `<a class="pr-link" href="${escapeHtml(repoMeta.pr.url)}" target="_blank">PR #${repoMeta.pr.number}: ${escapeHtml(repoMeta.pr.title)}</a>`;
    }
    bar.innerHTML = metaHtml;
    bar.style.display = '';
  }

  renderOverviewBanner();

  setFiles(parseDiff(data.diff));
  renderFileList();
  renderViewToggle();
  if (files.length > 0) selectFile(0);
  else document.getElementById('diff-container')!.innerHTML = '<div class="empty-state">No changes to review</div>';
  loadCommits();
}

function setupFileView(data: { content: string; claudeComments?: any[]; [key: string]: any }): void {
  document.querySelector<HTMLElement>('.sidebar')!.style.display = 'none';
  document.getElementById('resize-handle')!.style.display = 'none';
  document.getElementById('meta-bar')!.style.display = 'none';
  document.getElementById('description-banner')!.style.display = 'none';
  document.getElementById('overview-banner')!.style.display = 'none';
  document.getElementById('commit-panel')!.style.display = 'none';
  document.querySelector('.keyboard-hint')!.innerHTML =
    'Click any block to comment &middot; <kbd>Cmd+Enter</kbd> save &middot; <kbd>Esc</kbd> cancel';

  setClaudeComments((data.claudeComments || []).map((c, i) => ({ ...c, _item: activeItemId, _serverIndex: i })));
  setAppMode('file');
  renderMarkdown(data);
}

export async function switchToItem(itemId: string): Promise<void> {
  setActiveItemId(itemId);
  renderTabs();

  const data = await fetchItemData(itemId);

  if (data.mode === 'diff') {
    setupDiffView(data);
  } else if (data.mode === 'file') {
    setupFileView(data);
  }
}

// --- Overview banner ---

function renderOverviewBanner(): void {
  const banner = document.getElementById('overview-banner')!;
  if (!analysis) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = '';
  document.getElementById('overview-text')!.textContent = analysis.overview;
  document.getElementById('overview-strategy')!.textContent = analysis.reviewStrategy;

  const collapsed = localStorage.getItem('lgtm-overview-collapsed') === 'true';
  banner.classList.toggle('collapsed', collapsed);

  const toggle = document.getElementById('overview-toggle')!;
  const newToggle = toggle.cloneNode(true) as HTMLElement;
  toggle.replaceWith(newToggle);
  newToggle.addEventListener('click', () => {
    const isCollapsed = banner.classList.toggle('collapsed');
    localStorage.setItem('lgtm-overview-collapsed', String(isCollapsed));
  });
}

// --- Actions ---

export async function refreshDiff(): Promise<void> {
  try {
    await loadItems();
    await switchToItem(activeItemId);
    showToast('Refreshed');
  } catch (e: any) {
    showToast('Failed to refresh: ' + e.message);
  }
}

export async function handleSubmitReview(): Promise<void> {
  const btn = document.getElementById('submit-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const formatted = formatAllComments();
    const result = await apiSubmitReview(formatted, { ...comments });
    showToast(`Review round ${result.round} submitted!`, 3000);
    for (const key of Object.keys(comments)) delete comments[key];
    clearPersistedState();
    document.getElementById('description-banner')!.style.display = 'none';
    if (appMode === 'file') {
      renderMarkdownComments();
    } else {
      renderFileList();
      renderDiff(activeFileIdx);
    }
  } catch (e: any) {
    showToast('Failed to submit: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Review';
  }
}

// --- Keyboard shortcuts ---

function getAdjacentFileIdx(direction: 'next' | 'prev'): number | null {
  const items = Array.from(document.querySelectorAll<HTMLElement>('.file-item:not(.hidden)'));
  const currentPos = items.findIndex(el => parseInt(el.dataset.idx!) === activeFileIdx);
  const targetPos = direction === 'next' ? currentPos + 1 : currentPos - 1;
  if (targetPos < 0 || targetPos >= items.length) return null;
  return parseInt(items[targetPos].dataset.idx!);
}

export function setupKeyboardShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      const nextIdx = getAdjacentFileIdx('next');
      if (nextIdx !== null) selectFile(nextIdx);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      const prevIdx = getAdjacentFileIdx('prev');
      if (prevIdx !== null) selectFile(prevIdx);
    } else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
      refreshDiff();
    } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      document.getElementById('file-search')!.focus();
    } else if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
      if (allCommits.length > 0) toggleCommitPanel();
    } else if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
      if (files[activeFileIdx]) {
        const path = files[activeFileIdx].path;
        if (reviewedFiles.has(path)) reviewedFiles.delete(path);
        else reviewedFiles.add(path);
        renderFileList();
      }
    } else if (e.key === 'w' && !e.metaKey && !e.ctrlKey) {
      if (appMode === 'diff' && files[activeFileIdx]) {
        if (wholeFileView) {
          setWholeFileView(false);
          renderDiff(activeFileIdx);
        } else {
          setWholeFileView(true);
          showWholeFile(activeFileIdx);
        }
      }
    } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
      jumpToComment('next');
    } else if (e.key === 'p' && !e.metaKey && !e.ctrlKey) {
      jumpToComment('prev');
    }
  });
}

// --- Resizable sidebar ---

export function setupResizableSidebar(): void {
  const handle = document.getElementById('resize-handle')!;
  const sidebar = document.querySelector('.sidebar') as HTMLElement;
  let dragging = false;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const newWidth = Math.min(Math.max(e.clientX, 150), 600);
    sidebar.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}
