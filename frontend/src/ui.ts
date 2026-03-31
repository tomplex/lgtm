import {
  files, activeFileIdx, comments, claudeComments, reviewedFiles,
  sessionItems, activeItemId, repoMeta, allCommits, selectedShas, appMode,
  wholeFileView, setWholeFileView,
  setFiles, setActiveFileIdx, setRepoMeta, setClaudeComments,
  setSessionItems, setActiveItemId, setAllCommits, setAppMode,
  resetLineIds,
} from './state';
import { fetchItems, fetchItemData, fetchCommits, submitReview as apiSubmitReview } from './api';
import { escapeHtml, showToast } from './utils';
import { parseDiff, renderDiff, selectFile, showWholeFile } from './diff';
import { renderMarkdown, renderMarkdownComments } from './document';
import { jumpToComment, formatAllComments } from './comments';

// --- File list sidebar ---

export function renderFileList(): void {
  const el = document.getElementById('file-list')!;
  el.innerHTML = '';
  let totalAdd = 0, totalDel = 0;

  files.forEach((file, idx) => {
    totalAdd += file.additions;
    totalDel += file.deletions;

    const div = document.createElement('div');
    const isReviewed = reviewedFiles.has(file.path);
    div.className = 'file-item' + (idx === activeFileIdx ? ' active' : '') + (isReviewed ? ' reviewed' : '');
    div.dataset.idx = String(idx);

    const commentCount = Object.keys(comments).filter(k => k.startsWith(file.path + '::')).length;
    const claudeCount = claudeComments.filter(c => c.file === file.path).length;

    const lastSlash = file.path.lastIndexOf('/');
    const dir = lastSlash >= 0 ? file.path.slice(0, lastSlash + 1) : '';
    const base = lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path;

    div.innerHTML = `
      <span class="review-check" title="Mark as reviewed (e)">${isReviewed ? '&#10003;' : '&#9675;'}</span>
      <span class="filename" title="${escapeHtml(file.path)}">
        ${dir ? `<span class="dir">${escapeHtml(dir)}</span>` : ''}
        <span class="base">${escapeHtml(base)}</span>
      </span>
      ${claudeCount > 0 ? `<span class="badge claude-badge" title="Claude comments">${claudeCount}</span>` : ''}
      ${commentCount > 0 ? `<span class="badge comments-badge" title="Your comments">${commentCount}</span>` : ''}
      <span class="file-stats">
        <span class="add">+${file.additions}</span>
        <span class="del">-${file.deletions}</span>
      </span>
    `;
    div.querySelector('.review-check')!.addEventListener('click', (ev) => toggleReviewed(file.path, ev));
    div.onclick = () => selectFile(idx);
    el.appendChild(div);
  });

  document.getElementById('stats')!.innerHTML = `
    ${files.length} file${files.length !== 1 ? 's' : ''} &middot;
    <span class="add">+${totalAdd}</span> <span class="del">-${totalDel}</span>
    ${Object.keys(comments).length > 0 ? ` &middot; ${Object.keys(comments).length} comment${Object.keys(comments).length !== 1 ? 's' : ''}` : ''}
  `;

  const q = (document.getElementById('file-search') as HTMLInputElement).value;
  if (q) filterFiles(q);
}

function toggleReviewed(path: string, e?: Event): void {
  if (e) e.stopPropagation();
  if (reviewedFiles.has(path)) reviewedFiles.delete(path);
  else reviewedFiles.add(path);
  renderFileList();
}

function matchesGlob(path: string, pattern: string): boolean {
  // Convert simple glob to regex: * matches anything except /
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$'
  );
  // Match against full path or just the basename
  const basename = path.split('/').pop() || path;
  return regex.test(path) || regex.test(basename);
}

export function filterFiles(query: string): void {
  const q = query.trim().toLowerCase();
  if (!q) {
    document.querySelectorAll<HTMLElement>('.file-item').forEach(el => el.classList.remove('hidden'));
    return;
  }

  const terms = q.split(/\s+/);
  document.querySelectorAll<HTMLElement>('.file-item').forEach(el => {
    const path = el.querySelector('.filename')!.textContent!.trim().toLowerCase();
    const visible = terms.every(term => {
      if (term.startsWith('!')) {
        const neg = term.slice(1);
        if (!neg) return true;
        return neg.includes('*') ? !matchesGlob(path, neg) : !path.includes(neg);
      }
      return term.includes('*') ? matchesGlob(path, term) : path.includes(term);
    });
    el.classList.toggle('hidden', !visible);
  });
}

// --- Tabs ---

export function renderTabs(): void {
  const bar = document.getElementById('tab-bar')!;
  bar.innerHTML = '';
  for (const item of sessionItems) {
    const tab = document.createElement('div');
    tab.className = 'tab-item' + (item.id === activeItemId ? ' active' : '');
    tab.dataset.id = item.id;

    let badges = '';
    const effUserCount = item.id === 'diff'
      ? Object.keys(comments).filter(k => !k.startsWith('doc:')).length
      : Object.keys(comments).filter(k => k.startsWith(`doc:${item.id}:`)).length;
    const claudeCount = claudeComments.filter(c => c._item === item.id).length;

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
  } catch { /* ignore */ }
}

export async function switchToItem(itemId: string): Promise<void> {
  setActiveItemId(itemId);
  renderTabs();

  const data = await fetchItemData(itemId);

  if (data.mode === 'diff') {
    document.querySelector<HTMLElement>('.sidebar')!.style.display = '';
    document.getElementById('resize-handle')!.style.display = '';
    document.querySelector('.keyboard-hint')!.innerHTML = 'Click line to comment &middot; <kbd>Cmd+Enter</kbd> save &middot; <kbd>f</kbd> search (<code>!test *.py</code>) &middot; <kbd>w</kbd> whole file &middot; <kbd>e</kbd> reviewed &middot; <kbd>c</kbd> commits &middot; <kbd>n</kbd>/<kbd>p</kbd> next/prev comment';

    setRepoMeta(data.meta || {});
    setClaudeComments((data.claudeComments || []).map(c => ({ ...c, _item: 'diff' })));
    setAppMode('diff');

    if (data.description) {
      const banner = document.getElementById('description-banner')!;
      banner.textContent = data.description;
      banner.style.display = '';
    } else {
      document.getElementById('description-banner')!.style.display = 'none';
    }

    // Meta bar
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

    setFiles(parseDiff(data.diff));
    renderFileList();
    if (files.length > 0) selectFile(0);
    else document.getElementById('diff-container')!.innerHTML = '<div class="empty-state">No changes to review</div>';
    loadCommits();

  } else if (data.mode === 'file') {
    document.querySelector<HTMLElement>('.sidebar')!.style.display = 'none';
    document.getElementById('resize-handle')!.style.display = 'none';
    document.getElementById('meta-bar')!.style.display = 'none';
    document.getElementById('description-banner')!.style.display = 'none';
    document.querySelector('.keyboard-hint')!.innerHTML = 'Click any block to comment &middot; <kbd>Cmd+Enter</kbd> save &middot; <kbd>Esc</kbd> cancel';

    setClaudeComments((data.claudeComments || []).map(c => ({ ...c, _item: activeItemId })));
    setAppMode('file');
    renderMarkdown(data);
  }
}

// --- Commit picker ---

export async function loadCommits(): Promise<void> {
  try {
    const commits = await fetchCommits();
    setAllCommits(commits);
    if (commits.length === 0) return;

    document.getElementById('commit-toggle-wrap')!.style.display = '';
    commits.forEach(c => selectedShas.add(c.sha));
    updateCommitToggle();
    renderCommitPanel();
  } catch { /* ignore */ }
}

function updateCommitToggle(): void {
  const btn = document.getElementById('commit-toggle-btn')!;
  const total = allCommits.length;
  const selected = selectedShas.size;
  btn.innerHTML = selected === total ? `Commits (${total})` : `Commits (${selected}/${total})`;
}

export function toggleCommitPanel(): void {
  document.getElementById('commit-panel')!.classList.toggle('open');
}

function renderCommitPanel(): void {
  const panel = document.getElementById('commit-panel')!;
  let html = `<div class="commit-actions">
    <a data-action="select-all-commits">Select all</a>
    <a data-action="select-none-commits">Select none</a>
    <a data-action="apply-commits">Apply</a>
  </div>`;
  html += '<div class="commit-list">';
  for (const c of allCommits) {
    const checked = selectedShas.has(c.sha) ? 'checked' : '';
    html += `<label class="commit-item">
      <input type="checkbox" ${checked} data-sha="${c.sha}">
      <span class="commit-sha">${c.sha.slice(0, 7)}</span>
      <span class="commit-msg" title="${escapeHtml(c.message)}">${escapeHtml(c.message)}</span>
      <span class="commit-date">${escapeHtml(c.date)}</span>
    </label>`;
  }
  html += '</div>';
  panel.innerHTML = html;

  // Event listeners
  panel.querySelectorAll<HTMLInputElement>('input[data-sha]').forEach(el => {
    el.addEventListener('change', () => {
      if (el.checked) selectedShas.add(el.dataset.sha!);
      else selectedShas.delete(el.dataset.sha!);
      updateCommitToggle();
    });
  });
  panel.querySelector('[data-action="select-all-commits"]')!.addEventListener('click', () => {
    allCommits.forEach(c => selectedShas.add(c.sha));
    renderCommitPanel();
    updateCommitToggle();
  });
  panel.querySelector('[data-action="select-none-commits"]')!.addEventListener('click', () => {
    selectedShas.clear();
    renderCommitPanel();
    updateCommitToggle();
  });
  panel.querySelector('[data-action="apply-commits"]')!.addEventListener('click', applyCommitSelection);
}

async function applyCommitSelection(): Promise<void> {
  document.getElementById('commit-panel')!.classList.remove('open');

  const commits = selectedShas.size > 0 && selectedShas.size < allCommits.length
    ? Array.from(selectedShas).join(',')
    : undefined;

  try {
    const data = await fetchItemData('diff', commits);
    if (data.mode !== 'diff') return;
    setFiles(parseDiff(data.diff));
    resetLineIds();
    if (activeFileIdx >= files.length) setActiveFileIdx(0);
    renderFileList();
    if (files.length > 0) renderDiff(activeFileIdx);
    else document.getElementById('diff-container')!.innerHTML = '<div class="empty-state">No changes for selected commits</div>';
    showToast(`Showing ${selectedShas.size} commit${selectedShas.size !== 1 ? 's' : ''}`);
  } catch (e: any) {
    showToast('Failed to apply: ' + e.message);
  }
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

export function setupKeyboardShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      const next = activeFileIdx + 1;
      if (next < files.length) selectFile(next);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      const prev = activeFileIdx - 1;
      if (prev >= 0) selectFile(prev);
    } else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
      refreshDiff();
    } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      document.getElementById('file-search')!.focus();
    } else if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
      if (allCommits.length > 0) toggleCommitPanel();
    } else if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
      if (files[activeFileIdx]) toggleReviewed(files[activeFileIdx].path);
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

// --- File search ---

export function setupFileSearch(): void {
  const input = document.getElementById('file-search') as HTMLInputElement;
  input.addEventListener('input', () => filterFiles(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      filterFiles('');
      input.blur();
    } else if (e.key === 'Enter') {
      const first = document.querySelector<HTMLElement>('.file-item:not(.hidden)');
      if (first) selectFile(parseInt(first.dataset.idx!));
      input.blur();
    }
  });
}
