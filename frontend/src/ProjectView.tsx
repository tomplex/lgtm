import { createSignal, Show, onMount, onCleanup, createEffect } from 'solid-js';
import {
  files,
  activeFile,
  setActiveRowId,
  setActiveFilePath,
  watchActiveRowId,
  activeItemId,
  setActiveItemId,
  appMode,
  setAppMode,
  setFiles,
  setRepoMeta,
  setMdMeta,
  setAllCommits,
  setComments,
  replaceComments,
  setAnalysis,
  setWholeFileView,
  comments,
  sessionItems,
  setSessionItems,
  selectedShas,
  setSelectedShas,
  repoMeta,
  allCommits,
  paletteOpen,
  setPaletteOpen,
  collapsedFolders,
  setSessionCollapsedFolders,
  sessionCollapsedFolders,
  dismissedFolders,
  setDismissedFoldersStore,
  symbolSearchOpen,
  setSymbolSearchOpen,
  setWalkthrough,
  setWalkthroughStale,
  onWalkthroughReplaced,
  walkthroughMode,
  walkthrough,
  activeStopIdx,
  markStopVisited,
  setLspStatus,
  type Language,
} from './state';
import {
  fetchItems,
  fetchItemData,
  fetchCommits,
  fetchAnalysis,
  submitReview as apiSubmitReview,
  submitGithub as apiSubmitGithub,
  removeItem,
  baseUrl,
  getProjectSlug,
  fetchLspState,
  warmLsp,
  type LspWireStatus,
} from './api';
import { fetchComments } from './comment-api';
import { fetchWalkthrough } from './walkthrough-api';
import { parseDiff } from './diff';
import { formatAllComments } from './format-comments';
import { loadState, clearPersistedState, watchAndSave } from './persistence';
import { showToast } from './components/shared/Toast';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import SymbolSearch from './components/diff/SymbolSearch';
import ProjectPalette from './components/palette/ProjectPalette';
import LspBootstrap from './components/header/LspBootstrap';
import { WalkthroughView } from './components/walkthrough/WalkthroughView';

import Header from './components/header/Header';
import type { GithubEvent } from './components/header/Header';
import TabBar from './components/tabs/TabBar';
import CommitPanel from './components/commits/CommitPanel';
import Sidebar from './components/sidebar/Sidebar';
import DiffView from './components/diff/DiffView';
import DocumentView from './components/document/DocumentView';
import Toast from './components/shared/Toast';

export default function ProjectView() {
  const [commitPanelOpen, setCommitPanelOpen] = createSignal(false);
  const activeItemKey = `lgtm-active-item:${getProjectSlug()}`;

  // Per-item state: remembers active file path and scroll position per tab
  const itemState = new Map<string, { filePath: string | null; scrollTop: number }>();

  function saveCurrentItemState() {
    const id = activeItemId();
    const container = document.getElementById('diff-container');
    itemState.set(id, {
      filePath: activeFile()?.path ?? null,
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
      replaceComments(allComments);
    } catch {
      /* ignore */
    }
  }

  async function loadWalkthrough(): Promise<void> {
    try {
      const r = await fetchWalkthrough();
      setWalkthrough(r.walkthrough);
      setWalkthroughStale(r.stale);
      onWalkthroughReplaced();
    } catch {
      setWalkthrough(null);
      setWalkthroughStale(false);
    }
  }

  /**
   * Walkthrough renders against `files()` — the parsed diff. When the user is
   * on a document tab, `switchToItem` only fetches that item, leaving `files()`
   * empty. Fetch the diff out-of-band so walkthrough has data to render.
   */
  async function ensureDiffLoaded(): Promise<void> {
    if (files().length > 0) return;
    try {
      const data = await fetchItemData('diff');
      if (data.mode === 'diff') {
        setFiles(parseDiff(data.diff));
        if (!repoMeta().repoPath) setRepoMeta(data.meta || {});
      }
    } catch {
      /* ignore — walkthrough will fall back to empty artifacts */
    }
  }

  async function switchToItem(itemId: string) {
    saveCurrentItemState();
    setActiveItemId(itemId);
    localStorage.setItem(activeItemKey, itemId);
    const data = await fetchItemData(itemId);

    if (data.mode === 'diff') {
      setRepoMeta(data.meta || {});
      setAppMode('diff');
      setFiles(parseDiff(data.diff));
      const saved = itemState.get(itemId);
      const restoredPath = saved?.filePath;
      const f = restoredPath ? files().find((x) => x.path === restoredPath) : undefined;
      if (f) {
        setActiveFilePath(f.path);
      } else if (files().length > 0) {
        setActiveFilePath(files()[0].path);
      } else {
        setActiveRowId(null);
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
      const label =
        currentItem === 'diff'
          ? 'Code Changes'
          : (sessionItems().find((i) => i.id === currentItem)?.title ?? currentItem);
      showToast(`Review round ${result.round} submitted for ${label}!`, 3000);
      // Only clear comments for the submitted item
      setComments('list', (prev) => prev.filter((c) => c.item !== currentItem));
      clearPersistedState();
    } catch (e: any) {
      showToast('Failed to submit: ' + e.message);
    }
  }

  async function handleSubmitGithub(event: GithubEvent) {
    try {
      const result = await apiSubmitGithub(event);
      showToast('Review submitted to GitHub!', 3000);
      if (result.reviewUrl) {
        window.open(result.reviewUrl, '_blank');
      }
      setComments('list', (prev) => prev.filter((c) => c.item !== 'diff'));
      clearPersistedState();
    } catch (e: any) {
      showToast('GitHub submit failed: ' + e.message);
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
      if (!activeFile() && files().length > 0) setActiveFilePath(files()[0].path);
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
    onSymbolSearch: () => setSymbolSearchOpen(!symbolSearchOpen()),
    onOpenPalette: () => setPaletteOpen(!paletteOpen()),
  });

  // --- Walkthrough visited stops ---

  createEffect(() => {
    const w = walkthrough();
    const i = activeStopIdx();
    if (w && w.stops[i]) markStopVisited(w.stops[i].id);
  });

  // When a walkthrough exists but the diff hasn't been loaded (user is on a
  // document tab), fetch it so artifacts have something to render against.
  createEffect(() => {
    if (walkthrough()) ensureDiffLoaded();
  });

  // --- LSP status ---

  function languagesFromFiles(): Language[] {
    const present = new Set<Language>();
    for (const f of files()) {
      const p = f.path.toLowerCase();
      if (p.endsWith('.py')) present.add('python');
      else if (p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js') || p.endsWith('.jsx'))
        present.add('typescript');
      else if (p.endsWith('.rs')) present.add('rust');
    }
    return [...present];
  }

  function applyLspState(state: { python: LspWireStatus; typescript: LspWireStatus; rust: LspWireStatus }) {
    for (const lang of ['python', 'typescript', 'rust'] as const) {
      // 'partial' isn't in the frontend store union; treat it as 'ok' so the badge hides it.
      const wire = state[lang];
      const status = wire === 'partial' ? 'ok' : wire;
      setLspStatus(lang, status);
    }
  }

  let lspPollTimer: number | null = null;
  let lastWarmKey = '';

  async function refreshLspState() {
    try {
      const state = await fetchLspState();
      applyLspState(state);
    } catch {
      /* server hiccup — keep last known state */
    }
  }

  // Warm whenever the set of relevant languages changes (files() is loaded async).
  createEffect(() => {
    const langs = languagesFromFiles();
    const key = langs.slice().sort().join(',');
    if (key === lastWarmKey || langs.length === 0) return;
    lastWarmKey = key;
    warmLsp(langs)
      .then(applyLspState)
      .catch(() => {});
  });

  // --- SSE ---

  function connectSSE() {
    const es = new EventSource(`${baseUrl()}/events`);
    es.addEventListener('comments_changed', async () => {
      const prevClaudeCount = comments.list.filter((c) => c?.author === 'claude' && !c.parentId).length;
      await loadComments();
      const newClaudeCount = comments.list.filter((c) => c?.author === 'claude' && !c.parentId).length;
      if (newClaudeCount > prevClaudeCount) {
        showToast('New comments from Claude', 2000);
      }
    });
    es.addEventListener('items_changed', () => {
      loadItems().then(() => showToast('Review items updated', 2000));
    });
    es.addEventListener('walkthrough_changed', () => {
      loadWalkthrough().then(() => showToast('Walkthrough updated', 2000));
    });
    es.addEventListener('git_changed', async () => {
      handleRefresh();
      loadWalkthrough();
      // Also reload commits since they may have changed
      try {
        const commits = await fetchCommits();
        setAllCommits(commits);
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      es.close();
      setTimeout(connectSSE, 5000);
    };
  }

  // --- Init ---

  onMount(async () => {
    await loadState();
    watchAndSave();
    watchActiveRowId();
    await loadItems();

    const analysisData = await fetchAnalysis();
    if (analysisData) setAnalysis(analysisData);

    await loadWalkthrough();

    const savedItem = localStorage.getItem(activeItemKey);
    const validItem = savedItem && sessionItems().some((i) => i.id === savedItem);
    await switchToItem(validItem ? savedItem! : 'diff');

    // Set page title
    const meta = repoMeta();
    if (meta.repoName) {
      document.title = `${meta.repoName} — ${meta.branch || ''}`;
    }

    navigateToHashFile();

    connectSSE();

    // LSP status: prime the badge once on mount, then poll on a slow cadence so
    // transitions (indexing → ok, missing → ok after bootstrap) get reflected.
    refreshLspState();
    lspPollTimer = window.setInterval(refreshLspState, 5000);

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

  onCleanup(() => {
    if (lspPollTimer != null) {
      clearInterval(lspPollTimer);
      lspPollTimer = null;
    }
  });

  // --- Hash navigation ---

  function navigateToHashFile() {
    const match = window.location.hash.match(/#file=(.+)/);
    if (!match) return;
    const path = decodeURIComponent(match[1]);
    const f = files().find((x) => x.path === path);
    if (!f) return;

    // Force-expand every ancestor folder so the file is visible (session-only, not persisted).
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const ancestor = segments.slice(0, i).join('/') + '/';
      if (collapsedFolders[ancestor] || sessionCollapsedFolders[ancestor] === true) {
        setSessionCollapsedFolders(ancestor, 'force-open');
      }
      if (dismissedFolders[ancestor]) setDismissedFoldersStore(ancestor, false);
    }

    if (activeFile()?.path !== path) {
      setActiveFilePath(path);
      setWholeFileView(false);
    }
  }

  window.addEventListener('hashchange', navigateToHashFile);

  return (
    <>
      <Header
        onRefresh={handleRefresh}
        onSubmit={handleSubmit}
        onSubmitGithub={handleSubmitGithub}
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
          <Show
            when={walkthroughMode()}
            fallback={
              <Show when={appMode() === 'diff'} fallback={<DocumentView />}>
                <Show when={files().length > 0} fallback={<div class="empty-state">No changes to review</div>}>
                  <DiffView />
                </Show>
              </Show>
            }
          >
            <WalkthroughView />
          </Show>
        </div>
      </div>
      <Toast />
      <Show when={appMode() === 'diff'}>
        <div class="keyboard-hint">
          Click line to comment &middot; <kbd>Cmd+Enter</kbd> save &middot; <kbd>f</kbd> search (<code>!test *.py</code>
          ) &middot; <kbd>w</kbd> whole file &middot; <kbd>e</kbd> reviewed &middot; <kbd>c</kbd> commits &middot;{' '}
          <kbd>n</kbd>/<kbd>p</kbd> next/prev comment &middot; <kbd>Shift Shift</kbd> symbol search
        </div>
      </Show>
      <Show when={appMode() === 'file'}>
        <div class="keyboard-hint">
          Click any block to comment &middot; <kbd>Cmd+Enter</kbd> save &middot; <kbd>Esc</kbd> cancel
        </div>
      </Show>
      <SymbolSearch />
      <ProjectPalette />
      <LspBootstrap />
    </>
  );
}
