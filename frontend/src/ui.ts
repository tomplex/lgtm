import {
  files,
  activeFileIdx,
  comments,
  claudeComments,
  sessionItems,
  activeItemId,
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
import { fetchItems, fetchItemData, submitReview as apiSubmitReview, fetchRepoFiles, addItem, removeItem } from './api';
import { escapeHtml, showToast } from './utils';
import { parseDiff, renderDiff, selectFile, showWholeFile } from './diff';
import { renderMarkdown, renderMarkdownComments } from './document';
import { jumpToComment, formatAllComments } from './comments';
import { clearPersistedState, saveState } from './persistence';
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

    const effUserCount =
      item.id === 'diff'
        ? Object.keys(comments).filter((k) => !k.startsWith('doc:') && !k.startsWith('claude:')).length
        : Object.keys(comments).filter((k) => k.startsWith(`doc:${item.id}:`)).length;
    const claudeCount = claudeComments.filter((c) => c._item === item.id).length;

    let badges = '';
    if (claudeCount > 0) badges += `<span class="tab-badge claude">${claudeCount}</span>`;
    if (effUserCount > 0) badges += `<span class="tab-badge user">${effUserCount}</span>`;

    const closeHtml = item.id !== 'diff'
      ? `<span class="tab-close" data-close-tab="${item.id}">&times;</span>`
      : '';
    tab.innerHTML = `<span class="tab-title">${escapeHtml(item.title)}</span>${badges}${closeHtml}`;
    tab.onclick = () => switchToItem(item.id);
    bar.appendChild(tab);
  }

  // Add "+" button
  const addBtn = document.createElement('div');
  addBtn.className = 'tab-item tab-add';
  addBtn.textContent = '+';
  addBtn.onclick = (e) => { e.stopPropagation(); openFilePicker(); };
  bar.appendChild(addBtn);

  // Delegated close handler
  bar.addEventListener('click', (e) => {
    const closeEl = (e.target as HTMLElement).closest<HTMLElement>('[data-close-tab]');
    if (!closeEl) return;
    e.stopPropagation();
    const itemId = closeEl.dataset.closeTab!;
    closeTab(itemId);
  });
}

async function closeTab(itemId: string): Promise<void> {
  try {
    await removeItem(itemId);
    await loadItems();
    if (activeItemId === itemId) await switchToItem('diff');
    else renderTabs();
  } catch (e: any) {
    showToast('Failed to remove: ' + e.message);
  }
}

// --- File picker for adding document tabs ---

let pickerOpen = false;

async function openFilePicker(): Promise<void> {
  if (pickerOpen) { closeFilePicker(); return; }
  pickerOpen = true;

  const bar = document.getElementById('tab-bar')!;
  const existing = document.getElementById('file-picker');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.id = 'file-picker';
  picker.innerHTML = `
    <input type="text" id="file-picker-input" placeholder="Filter files..." autocomplete="off">
    <div id="file-picker-list"></div>
  `;
  bar.after(picker);

  const input = picker.querySelector('#file-picker-input') as HTMLInputElement;
  const listEl = picker.querySelector('#file-picker-list') as HTMLDivElement;

  let allFiles: string[] = [];
  try {
    allFiles = await fetchRepoFiles('**/*.md');
  } catch { /* empty */ }

  // Filter out files already added as tabs
  const existingPaths = new Set(sessionItems.filter(i => i.path).map(i => i.path));

  function renderList(query: string): void {
    const q = query.toLowerCase();
    const filtered = allFiles.filter(f =>
      !existingPaths.has(f) && (!q || f.toLowerCase().includes(q))
    );
    listEl.innerHTML = '';
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="file-picker-empty">No matching files</div>';
      return;
    }
    for (const file of filtered.slice(0, 20)) {
      const row = document.createElement('div');
      row.className = 'file-picker-row';
      row.textContent = file;
      row.onclick = () => selectPickerFile(file);
      listEl.appendChild(row);
    }
    if (filtered.length > 20) {
      const more = document.createElement('div');
      more.className = 'file-picker-empty';
      more.textContent = `${filtered.length - 20} more — type to filter`;
      listEl.appendChild(more);
    }
  }

  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeFilePicker(); e.preventDefault(); }
    if (e.key === 'Enter') {
      const first = listEl.querySelector<HTMLElement>('.file-picker-row');
      if (first) first.click();
      e.preventDefault();
    }
  });

  renderList('');
  input.focus();

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', closePickerOnClickOutside);
  }, 0);
}

function closePickerOnClickOutside(e: Event): void {
  const picker = document.getElementById('file-picker');
  if (picker && !picker.contains(e.target as Node)) {
    closeFilePicker();
  }
}

function closeFilePicker(): void {
  pickerOpen = false;
  document.getElementById('file-picker')?.remove();
  document.removeEventListener('click', closePickerOnClickOutside);
}

async function selectPickerFile(filepath: string): Promise<void> {
  closeFilePicker();
  try {
    await addItem(filepath);
    await loadItems();
    await switchToItem(sessionItems[sessionItems.length - 1]?.id ?? 'diff');
    showToast(`Added ${filepath.split('/').pop()}`);
  } catch (e: any) {
    showToast('Failed to add: ' + e.message);
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
        saveState();
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
