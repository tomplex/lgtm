import { createSignal, Show, onMount } from 'solid-js';
import {
  files,
  activeFileIdx,
  activeItemId,
  setActiveItemId,
  appMode,
  setAppMode,
  setFiles,
  setRepoMeta,
  setMdMeta,
  setAllCommits,
  setComments,
  setAnalysis,
  setWholeFileView,
  setActiveFileIdx,
  comments,
  sessionItems,
  setSessionItems,
  selectedShas,
  setSelectedShas,
  repoMeta,
  allCommits,
} from './state';
import {
  fetchItems,
  fetchItemData,
  fetchCommits,
  fetchAnalysis,
  submitReview as apiSubmitReview,
  removeItem,
  baseUrl,
} from './api';
import { fetchComments } from './comment-api';
import { parseDiff } from './diff';
import { formatAllComments } from './format-comments';
import { loadState, clearPersistedState } from './persistence';
import { showToast } from './components/shared/Toast';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

import Header from './components/header/Header';
import TabBar from './components/tabs/TabBar';
import CommitPanel from './components/commits/CommitPanel';
import Sidebar from './components/sidebar/Sidebar';
import DiffView from './components/diff/DiffView';
import DocumentView from './components/document/DocumentView';
import Toast from './components/shared/Toast';

export default function App() {
  const [commitPanelOpen, setCommitPanelOpen] = createSignal(false);

  // Per-item state: remembers file index and scroll position per tab
  const itemState = new Map<string, { fileIdx: number; scrollTop: number }>();

  function saveCurrentItemState() {
    const id = activeItemId();
    const container = document.getElementById('diff-container');
    itemState.set(id, {
      fileIdx: activeFileIdx(),
      scrollTop: container?.scrollTop ?? 0,
    });
  }

  function restoreItemState(itemId: string) {
    const saved = itemState.get(itemId);
    if (saved) {
      requestAnimationFrame(() => {
        const container = document.getElementById('diff-container');
        if (container) container.scrollTop = saved.scrollTop;
      });
    }
  }

  // --- Data loading ---

  async function loadItems() {
    try {
      const items = await fetchItems();
      setSessionItems(items);
    } catch {
      /* ignore */
    }
  }

  async function loadComments() {
    try {
      const allComments = await fetchComments();
      setComments('list', allComments);
    } catch {
      /* ignore */
    }
  }

  async function switchToItem(itemId: string) {
    saveCurrentItemState();
    setActiveItemId(itemId);
    localStorage.setItem('lgtm-active-item', itemId);
    const data = await fetchItemData(itemId);

    if (data.mode === 'diff') {
      setRepoMeta(data.meta || {});
      setAppMode('diff');
      setFiles(parseDiff(data.diff));
      const saved = itemState.get(itemId);
      if (saved && saved.fileIdx < files().length) {
        setActiveFileIdx(saved.fileIdx);
      } else if (files().length > 0 && activeFileIdx() >= files().length) {
        setActiveFileIdx(0);
      }
      setWholeFileView(false);
      await loadComments();

      // Load commits
      try {
        const commits = await fetchCommits();
        setAllCommits(commits);
        if (commits.length > 0) {
          const onBaseBranch = repoMeta().branch === repoMeta().baseBranch;
          if (!onBaseBranch) {
            for (const c of commits) setSelectedShas(c.sha, true);
          }
        }
      } catch {
        /* ignore */
      }
    } else if (data.mode === 'file') {
      setAppMode('file');
      setCommitPanelOpen(false);
      setMdMeta({
        content: data.content,
        filename: data.filename,
        filepath: data.filepath,
        markdown: data.markdown,
        title: data.title,
      });
      await loadComments();
    }
    restoreItemState(itemId);
  }

  async function handleRefresh() {
    try {
      await loadItems();
      await switchToItem(activeItemId());
      showToast('Refreshed');
    } catch (e: any) {
      showToast('Failed to refresh: ' + e.message);
    }
  }

  async function handleSubmit() {
    try {
      const currentItem = activeItemId();
      const blockPreviews: Record<string, string> = {};
      document.querySelectorAll<HTMLElement>('.md-block[data-block]').forEach((el) => {
        const blockIdx = el.dataset.block;
        if (blockIdx != null) {
          const key = `${currentItem}-${blockIdx}`;
          blockPreviews[key] = el.textContent?.trim()?.slice(0, 80) || `Block ${blockIdx}`;
        }
      });

      const formatted = formatAllComments(comments.list, files(), sessionItems(), blockPreviews, currentItem);
      const result = await apiSubmitReview(formatted, {}, currentItem);
      const label = currentItem === 'diff' ? 'Code Changes' : sessionItems().find((i) => i.id === currentItem)?.title ?? currentItem;
      showToast(`Review round ${result.round} submitted for ${label}!`, 3000);
      // Only clear comments for the submitted item
      setComments('list', (prev) => prev.filter((c) => c.item !== currentItem));
      clearPersistedState();
    } catch (e: any) {
      showToast('Failed to submit: ' + e.message);
    }
  }

  async function handleCloseTab(itemId: string) {
    try {
      await removeItem(itemId);
      await loadItems();
      if (activeItemId() === itemId) await switchToItem('diff');
    } catch (e: any) {
      showToast('Failed to remove: ' + e.message);
    }
  }

  async function handleApplyCommits() {
    setCommitPanelOpen(false);
    const shas = allCommits()
      .filter((c) => selectedShas[c.sha])
      .map((c) => c.sha);
    const commits = shas.length > 0 && shas.length < allCommits().length ? shas.join(',') : undefined;

    try {
      const data = await fetchItemData('diff', commits);
      if (data.mode !== 'diff') return;
      setFiles(parseDiff(data.diff));
      if (activeFileIdx() >= files().length) setActiveFileIdx(0);
      showToast(`Showing ${shas.length} commit${shas.length !== 1 ? 's' : ''}`);
    } catch (e: any) {
      showToast('Failed to apply: ' + e.message);
    }
  }

  function jumpToComment(direction: 'next' | 'prev') {
    const container = document.getElementById('diff-container')!;
    const rows = Array.from(container.querySelectorAll('tr.comment-row, tr.claude-comment-row'));
    if (rows.length === 0) return;
    const containerRect = container.getBoundingClientRect();

    if (direction === 'next') {
      const next = rows.find((r) => r.getBoundingClientRect().top > containerRect.top + 10);
      if (next) next.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else rows[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      const prev = rows.reverse().find((r) => r.getBoundingClientRect().top < containerRect.top - 10);
      if (prev) prev.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else rows[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // --- Keyboard shortcuts ---

  useKeyboardShortcuts({
    onRefresh: handleRefresh,
    onToggleCommits: () => setCommitPanelOpen(!commitPanelOpen()),
    onJumpComment: jumpToComment,
  });

  // --- SSE ---

  function connectSSE() {
    const es = new EventSource(`${baseUrl()}/events`);
    es.addEventListener('comments_changed', async () => {
      const prevClaudeCount = comments.list.filter((c) => c.author === 'claude' && !c.parentId).length;
      await loadComments();
      const newClaudeCount = comments.list.filter((c) => c.author === 'claude' && !c.parentId).length;
      if (newClaudeCount > prevClaudeCount) {
        showToast('New comments from Claude', 2000);
      }
    });
    es.addEventListener('items_changed', () => {
      loadItems().then(() => showToast('Review items updated', 2000));
    });
    es.addEventListener('git_changed', async () => {
      handleRefresh();
      // Also reload commits since they may have changed
      try {
        const commits = await fetchCommits();
        setAllCommits(commits);
      } catch { /* ignore */ }
    });
    es.onerror = () => {
      es.close();
      setTimeout(connectSSE, 5000);
    };
  }

  // --- Init ---

  onMount(async () => {
    await loadState();
    await loadItems();

    const analysisData = await fetchAnalysis();
    if (analysisData) setAnalysis(analysisData);

    const savedItem = localStorage.getItem('lgtm-active-item');
    const validItem = savedItem && sessionItems().some((i) => i.id === savedItem);
    await switchToItem(validItem ? savedItem! : 'diff');

    // Set page title
    const meta = repoMeta();
    if (meta.repoName) {
      document.title = `${meta.repoName} — ${meta.branch || ''}`;
    }

    connectSSE();

    // Resizable sidebar
    const handle = document.getElementById('resize-handle');
    const sidebar = document.querySelector('.sidebar') as HTMLElement | null;
    if (handle && sidebar) {
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
        sidebar.style.width = Math.min(Math.max(e.clientX, 150), 600) + 'px';
      });
      document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      });
    }
  });

  // --- Hash navigation ---

  window.addEventListener('hashchange', () => {
    const match = window.location.hash.match(/#file=(.+)/);
    if (!match) return;
    const path = decodeURIComponent(match[1]);
    const idx = files().findIndex((f) => f.path === path);
    if (idx >= 0 && idx !== activeFileIdx()) {
      setActiveFileIdx(idx);
      setWholeFileView(false);
    }
  });

  return (
    <>
      <Header
        onRefresh={handleRefresh}
        onSubmit={handleSubmit}
        onToggleCommits={() => setCommitPanelOpen(!commitPanelOpen())}
        showCommitToggle={appMode() === 'diff' && allCommits().length > 0}
      />
      <TabBar onSwitchItem={switchToItem} onCloseTab={handleCloseTab} />
      <CommitPanel visible={commitPanelOpen()} onApply={handleApplyCommits} />
      <div class="main">
        <Show when={appMode() === 'diff'}>
          <Sidebar />
          <div class="resize-handle" id="resize-handle" />
        </Show>
        <div class="diff-container" id="diff-container">
          <Show when={appMode() === 'diff'} fallback={<DocumentView />}>
            <Show when={files().length > 0} fallback={<div class="empty-state">No changes to review</div>}>
              <DiffView />
            </Show>
          </Show>
        </div>
      </div>
      <Toast />
      <Show when={appMode() === 'diff'}>
        <div class="keyboard-hint">
          Click line to comment &middot; <kbd>Cmd+Enter</kbd> save &middot; <kbd>f</kbd> search (<code>!test *.py</code>
          ) &middot; <kbd>w</kbd> whole file &middot; <kbd>e</kbd> reviewed &middot; <kbd>c</kbd> commits &middot;{' '}
          <kbd>n</kbd>/<kbd>p</kbd> next/prev comment
        </div>
      </Show>
      <Show when={appMode() === 'file'}>
        <div class="keyboard-hint">
          Click any block to comment &middot; <kbd>Cmd+Enter</kbd> save &middot; <kbd>Esc</kbd> cancel
        </div>
      </Show>
    </>
  );
}
