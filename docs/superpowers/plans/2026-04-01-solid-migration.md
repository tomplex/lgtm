# SolidJS Frontend Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the LGTM frontend from vanilla TypeScript to SolidJS, preserving all existing functionality and fixing the whole-file comment bug by design.

**Architecture:** Signal-based reactive state (`createSignal` / `createStore`) drives a component tree. Pure functions (diff parsing, analysis sorting, formatting) carry over unchanged. Components are organized one-per-file in directories matching UI regions.

**Tech Stack:** SolidJS, Vite + vite-plugin-solid, TypeScript, Vitest, highlight.js, marked

---

## File Structure

```
frontend/src/
├── main.tsx                          # Entry point: render <App/>, SSE connection
├── App.tsx                           # Root component, layout shell
├── state.ts                          # All signals and stores
├── api.ts                            # Fetch functions (unchanged)
├── comment-api.ts                    # Comment CRUD (unchanged)
├── comment-types.ts                  # Comment interface (unchanged)
├── utils.ts                          # escapeHtml, detectLang, highlightLine, renderMd (unchanged)
├── analysis.ts                       # sortFilesByPriority, groupFiles, phaseFiles (unchanged)
├── persistence.ts                    # Load/save user state via API (adapted to use signals)
├── format-comments.ts                # formatAllComments extracted as pure function
├── components/
│   ├── header/
│   │   └── Header.tsx                # Repo name, branch, PR link, stats, action buttons
│   ├── tabs/
│   │   ├── TabBar.tsx                # Session item tabs with badges
│   │   └── FilePicker.tsx            # Overlay for adding document tabs
│   ├── commits/
│   │   └── CommitPanel.tsx           # Collapsible commit selection panel
│   ├── overview/
│   │   └── OverviewBanner.tsx        # Analysis overview + strategy
│   ├── sidebar/
│   │   ├── Sidebar.tsx               # Container: search + view toggle + file list
│   │   ├── FileSearch.tsx            # Filter input with glob support
│   │   ├── ViewToggle.tsx            # Flat/grouped/phased buttons
│   │   └── FileList.tsx              # File items (flat, grouped, phased views)
│   ├── diff/
│   │   ├── DiffView.tsx              # Diff table container, context expansion
│   │   ├── DiffLine.tsx              # Single diff line (works in both diff and whole-file views)
│   │   ├── WholeFileView.tsx         # Full file display (reuses DiffLine)
│   │   └── WordDiff.tsx              # Inline word-level diff highlighting
│   ├── comments/
│   │   ├── CommentRow.tsx            # Rendered comment (user or Claude) with actions
│   │   ├── CommentTextarea.tsx       # New/edit textarea with save/cancel
│   │   └── ReplyTextarea.tsx         # Reply textarea for threaded comments
│   ├── document/
│   │   └── DocumentView.tsx          # Markdown document with block commenting
│   └── shared/
│       └── Toast.tsx                 # Toast notification
├── hooks/
│   └── useKeyboardShortcuts.ts       # Global keyboard shortcut handler
└── __tests__/
    ├── diff.test.ts                  # Existing parseDiff tests (unchanged)
    ├── utils.test.ts                 # Existing escapeHtml/detectLang tests (unchanged)
    ├── analysis.test.ts              # Existing sorting/grouping tests (unchanged)
    └── format-comments.test.ts       # Tests for extracted format functions
```

### Key decisions in this structure:

- **Pure functions stay as-is:** `api.ts`, `comment-api.ts`, `comment-types.ts`, `utils.ts`, `analysis.ts` don't change except for minor import adjustments.
- **`format-comments.ts`** is extracted from `comments.ts` because the current formatting functions read from DOM (`document.getElementById`) for block previews. In Solid, these become pure functions that receive data as arguments.
- **`DiffLine.tsx` is shared** between `DiffView` and `WholeFileView` — this is the core fix for the whole-file commenting bug.
- **`CommentRow.tsx`** unifies what was split between `comments.ts` (user comments) and `claude-comments.ts` (Claude comments). Both use the same `Comment` type now thanks to the unification refactor.

---

### Task 1: Build setup — Vite + Solid + TypeScript

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/tsconfig.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/main.tsx`
- Modify: `frontend/index.html`

- [ ] **Step 1: Install Solid dependencies**

Run:
```bash
cd frontend && npm install solid-js && npm install -D vite-plugin-solid
```

- [ ] **Step 2: Update `vite.config.ts` to use Solid plugin**

```ts
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    proxy: {
      '/project': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9900}`,
      },
      '/projects': {
        target: `http://127.0.0.1:${process.env.REVIEW_PORT || 9900}`,
      },
    },
  },
});
```

- [ ] **Step 3: Update `tsconfig.json` for Solid JSX**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "jsx": "preserve",
    "jsxImportSource": "solid-js"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create minimal `main.tsx` entry point**

```tsx
import { render } from 'solid-js/web';

function App() {
  return <div>LGTM — Solid migration in progress</div>;
}

render(() => <App />, document.getElementById('root')!);
```

- [ ] **Step 5: Simplify `index.html` to a root div**

Replace the entire `<body>` content with:
```html
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
```

- [ ] **Step 6: Verify the dev server starts and renders the placeholder**

Run: `cd frontend && npm run dev`

Expected: Browser shows "LGTM — Solid migration in progress" at localhost:5173.

- [ ] **Step 7: Run existing tests to make sure they still pass**

Run: `cd frontend && npm test`

Expected: All existing tests pass (`parseDiff`, `escapeHtml`, `detectLang`, `analysis`). These are pure function tests and don't depend on the DOM framework.

- [ ] **Step 8: Commit**

```bash
git add -A frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vite.config.ts frontend/src/main.tsx frontend/index.html
git commit -m "setup: add solid-js and vite-plugin-solid, minimal entry point"
```

---

### Task 2: State layer — signals and stores

**Files:**
- Create: `frontend/src/state.ts` (rewrite from current)

This is the foundation everything else builds on. All signals and stores live here.

- [ ] **Step 1: Write the new `state.ts`**

```ts
import { createSignal, createMemo } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { Comment } from './comment-types';

// --- Types (re-exported for consumers) ---

export interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk';
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export interface SessionItem {
  id: string;
  type: string;
  title: string;
  path?: string;
}

export interface RepoMeta {
  branch?: string;
  baseBranch?: string;
  repoPath?: string;
  repoName?: string;
  pr?: { url: string; number: number; title: string };
}

export interface MdMeta {
  content?: string;
  filename?: string;
  filepath?: string;
  markdown?: boolean;
  title?: string;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

interface FileAnalysis {
  priority: 'critical' | 'important' | 'normal' | 'low';
  phase: 'review' | 'skim' | 'rubber-stamp';
  summary: string;
  category: string;
}

interface AnalysisGroup {
  name: string;
  description?: string;
  files: string[];
}

export interface Analysis {
  overview: string;
  reviewStrategy: string;
  files: Record<string, FileAnalysis>;
  groups: AnalysisGroup[];
}

export type SidebarView = 'flat' | 'grouped' | 'phased';

// --- Signals (replaced wholesale) ---

export const [files, setFiles] = createSignal<DiffFile[]>([]);
export const [activeFileIdx, setActiveFileIdx] = createSignal(0);
export const [activeItemId, setActiveItemId] = createSignal('diff');
export const [appMode, setAppMode] = createSignal<'diff' | 'file'>('diff');
export const [wholeFileView, setWholeFileView] = createSignal(false);
export const [sidebarView, setSidebarView] = createSignal<SidebarView>('flat');
export const [repoMeta, setRepoMeta] = createSignal<RepoMeta>({});
export const [mdMeta, setMdMeta] = createSignal<MdMeta>({});
export const [sessionItems, setSessionItems] = createSignal<SessionItem[]>([]);
export const [allCommits, setAllCommits] = createSignal<Commit[]>([]);
export const [analysis, setAnalysis] = createSignal<Analysis | null>(null);

// --- Stores (partial updates) ---

export const [comments, setComments] = createStore<{ list: Comment[] }>({ list: [] });

export function addLocalComment(c: Comment) {
  setComments('list', (prev) => [...prev, c]);
}

export function updateLocalComment(id: string, fields: Partial<Comment>) {
  setComments('list', (item) => item.id === id, fields);
}

export function removeLocalComment(id: string) {
  setComments('list', (prev) => prev.filter((c) => c.id !== id));
}

export const [reviewedFiles, setReviewedFiles] = createStore<Record<string, boolean>>({});

export function toggleReviewed(path: string) {
  setReviewedFiles(path, (v) => !v);
}

export const [selectedShas, setSelectedShas] = createStore<Record<string, boolean>>({});

// --- Derived state ---

export const activeFile = createMemo(() => files()[activeFileIdx()]);

export const commentsByFile = createMemo(() => {
  const result: Record<string, Comment[]> = {};
  for (const c of comments.list) {
    if (c.file && !c.parentId && c.status !== 'dismissed') {
      if (!result[c.file]) result[c.file] = [];
      result[c.file].push(c);
    }
  }
  return result;
});

export const userCommentCount = createMemo(() =>
  comments.list.filter((c) => c.author === 'user' && !c.parentId && c.status !== 'dismissed').length,
);
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd frontend && npx tsc --noEmit`

Expected: No errors. (Some existing `.ts` files may error because they import from the old state module — that's expected and will be cleaned up as we replace them.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/state.ts
git commit -m "state: rewrite as solid signals and stores"
```

---

### Task 3: Shared components — Toast, CommentTextarea, CommentRow

**Files:**
- Create: `frontend/src/components/shared/Toast.tsx`
- Create: `frontend/src/components/comments/CommentTextarea.tsx`
- Create: `frontend/src/components/comments/CommentRow.tsx`
- Create: `frontend/src/components/comments/ReplyTextarea.tsx`

These are leaf components used throughout the app. Build them first so higher-level components can reference them.

- [ ] **Step 1: Create `Toast.tsx`**

```tsx
import { createSignal, Show } from 'solid-js';

const [toastMsg, setToastMsg] = createSignal('');
const [toastVisible, setToastVisible] = createSignal(false);
let toastTimer: ReturnType<typeof setTimeout>;

export function showToast(msg: string, duration = 2500) {
  clearTimeout(toastTimer);
  setToastMsg(msg);
  setToastVisible(true);
  toastTimer = setTimeout(() => setToastVisible(false), duration);
}

export default function Toast() {
  return (
    <div class="toast" classList={{ show: toastVisible() }}>
      {toastMsg()}
    </div>
  );
}
```

- [ ] **Step 2: Create `CommentTextarea.tsx`**

A reusable textarea for creating new comments or editing existing ones. Handles Cmd+Enter to save, Escape to cancel.

```tsx
import { onMount } from 'solid-js';

interface Props {
  initialText?: string;
  placeholder?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  showDelete?: boolean;
  onDelete?: () => void;
}

export default function CommentTextarea(props: Props) {
  let textareaRef!: HTMLTextAreaElement;

  onMount(() => {
    textareaRef.focus();
    if (props.initialText) {
      textareaRef.setSelectionRange(textareaRef.value.length, textareaRef.value.length);
    }
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      props.onCancel();
    } else if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      const text = textareaRef.value.trim();
      if (text) props.onSave(text);
      else props.onCancel();
    }
  }

  return (
    <div class="comment-box">
      <textarea
        ref={textareaRef}
        placeholder={props.placeholder ?? 'Leave a comment...'}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        {props.initialText ?? ''}
      </textarea>
      <div class="comment-actions">
        <button class="cancel-btn" onClick={(e) => { e.stopPropagation(); props.onCancel(); }}>
          Cancel
        </button>
        {props.showDelete && (
          <button
            class="cancel-btn"
            style="color: var(--del-text)"
            onClick={(e) => { e.stopPropagation(); props.onDelete?.(); }}
          >
            Delete
          </button>
        )}
        <button
          class="save-btn"
          onClick={(e) => {
            e.stopPropagation();
            const text = textareaRef.value.trim();
            if (text) props.onSave(text);
            else props.onCancel();
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `ReplyTextarea.tsx`**

```tsx
import { onMount } from 'solid-js';

interface Props {
  onSave: (text: string) => void;
  onCancel: () => void;
}

export default function ReplyTextarea(props: Props) {
  let textareaRef!: HTMLTextAreaElement;

  onMount(() => textareaRef.focus());

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      props.onCancel();
    } else if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      const text = textareaRef.value.trim();
      if (text) props.onSave(text);
      else props.onCancel();
    }
  }

  return (
    <div class="reply-textarea-wrap">
      <textarea
        ref={textareaRef}
        class="reply-input"
        style="width:100%;min-height:36px;padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;resize:vertical;outline:none;font-family:inherit;"
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      />
      <div class="comment-actions" style="margin-top:4px">
        <button class="cancel-btn" onClick={(e) => { e.stopPropagation(); props.onCancel(); }}>
          Cancel
        </button>
        <button
          class="save-btn"
          onClick={(e) => {
            e.stopPropagation();
            const text = textareaRef.value.trim();
            if (text) props.onSave(text);
            else props.onCancel();
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `CommentRow.tsx`**

This renders a single comment (user or Claude) with its replies and action buttons. Replaces both `renderCommentHtml` from `claude-comments.ts` and the user comment rendering from `comments.ts`.

```tsx
import { createSignal, For, Show } from 'solid-js';
import { renderMd, escapeHtml } from '../../utils';
import { comments, addLocalComment, updateLocalComment, removeLocalComment } from '../../state';
import { createComment as apiCreateComment, updateComment as apiUpdateComment, deleteComment as apiDeleteComment } from '../../comment-api';
import type { Comment } from '../../comment-types';
import CommentTextarea from './CommentTextarea';
import ReplyTextarea from './ReplyTextarea';

interface Props {
  comment: Comment;
}

export default function CommentRow(props: Props) {
  const [replying, setReplying] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [editingReplyId, setEditingReplyId] = createSignal<string | null>(null);

  const replies = () => comments.list.filter((c) => c.parentId === props.comment.id);
  const isResolved = () => props.comment.status === 'resolved';
  const isDismissed = () => props.comment.status === 'dismissed';

  async function handleResolve() {
    updateLocalComment(props.comment.id, { status: 'resolved' });
    apiUpdateComment(props.comment.id, { status: 'resolved' });
  }

  async function handleUnresolve() {
    updateLocalComment(props.comment.id, { status: 'active' });
    apiUpdateComment(props.comment.id, { status: 'active' });
  }

  async function handleDismiss() {
    updateLocalComment(props.comment.id, { status: 'dismissed' });
    apiUpdateComment(props.comment.id, { status: 'dismissed' });
  }

  async function handleDelete() {
    removeLocalComment(props.comment.id);
    apiDeleteComment(props.comment.id);
  }

  async function handleEdit(text: string) {
    updateLocalComment(props.comment.id, { text });
    setEditing(false);
    apiUpdateComment(props.comment.id, { text });
  }

  async function handleReply(text: string) {
    const tempId = `temp-${Date.now()}`;
    const localComment: Comment = {
      id: tempId,
      author: 'user',
      text,
      status: 'active',
      parentId: props.comment.id,
      item: props.comment.item,
      file: props.comment.file,
      line: props.comment.line,
      block: props.comment.block,
    };
    addLocalComment(localComment);
    setReplying(false);
    try {
      const created = await apiCreateComment({
        author: 'user',
        text,
        item: props.comment.item,
        parentId: props.comment.id,
        file: props.comment.file,
        line: props.comment.line,
        block: props.comment.block,
      });
      updateLocalComment(tempId, { id: created.id });
    } catch { /* optimistic update already applied */ }
  }

  async function handleEditReply(replyId: string, text: string) {
    updateLocalComment(replyId, { text });
    setEditingReplyId(null);
    apiUpdateComment(replyId, { text });
  }

  async function handleDeleteReply(replyId: string) {
    removeLocalComment(replyId);
    apiDeleteComment(replyId);
  }

  return (
    <div
      class="claude-comment"
      classList={{ resolved: isResolved() }}
      data-comment-id={props.comment.id}
    >
      <div class="claude-header">
        <span class="claude-label">
          {props.comment.author === 'claude' ? 'Claude' : 'You'}
        </span>

        <Show when={isResolved()}>
          <span class="resolve-badge">Resolved</span>
          <span class="inline-actions">
            <a onClick={handleUnresolve}>unresolve</a>
          </span>
        </Show>

        <Show when={isDismissed()}>
          <span class="resolve-badge">Dismissed</span>
        </Show>

        <Show when={!isResolved() && !isDismissed() && props.comment.author === 'claude'}>
          <span class="inline-actions">
            <a onClick={() => setReplying(true)}>reply</a>
            <a onClick={handleResolve}>resolve</a>
            <a onClick={handleDismiss}>dismiss</a>
          </span>
        </Show>

        <Show when={!isResolved() && !isDismissed() && props.comment.author === 'user'}>
          <span class="inline-actions">
            <a onClick={() => setEditing(true)}>edit</a>
            <a class="del-action" onClick={handleDelete}>delete</a>
          </span>
        </Show>
      </div>

      <Show when={editing()} fallback={
        <div class="claude-text" innerHTML={renderMd(props.comment.text)} />
      }>
        <CommentTextarea
          initialText={props.comment.text}
          onSave={handleEdit}
          onCancel={() => setEditing(false)}
        />
      </Show>

      <For each={replies()}>
        {(reply) => (
          <div class="claude-reply">
            <div class="claude-reply-header">
              <span class="reply-label">
                {reply.author === 'claude' ? 'Claude' : 'You'}
              </span>
              <span class="inline-actions">
                <a onClick={() => setEditingReplyId(reply.id)}>edit</a>
                <a class="del-action" onClick={() => handleDeleteReply(reply.id)}>delete</a>
              </span>
            </div>
            <Show when={editingReplyId() === reply.id} fallback={
              <div class="reply-text" innerHTML={renderMd(reply.text)} />
            }>
              <CommentTextarea
                initialText={reply.text}
                onSave={(text) => handleEditReply(reply.id, text)}
                onCancel={() => setEditingReplyId(null)}
              />
            </Show>
          </div>
        )}
      </For>

      <Show when={replying()}>
        <ReplyTextarea
          onSave={handleReply}
          onCancel={() => setReplying(false)}
        />
      </Show>
    </div>
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`

Expected: No errors in the new component files. (Existing old files may error — that's expected.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/
git commit -m "components: toast, comment textarea, comment row, reply textarea"
```

---

### Task 4: DiffLine component — the shared line renderer

**Files:**
- Create: `frontend/src/components/diff/WordDiff.tsx`
- Create: `frontend/src/components/diff/DiffLine.tsx`

This is the key component that fixes the whole-file commenting bug. `DiffLine` renders a single line with line numbers, syntax highlighting, and click-to-comment — used identically in both diff and whole-file views.

- [ ] **Step 1: Create `WordDiff.tsx`**

Extracted from the current `computeWordDiff` / `renderWordDiff` functions. The computation stays pure; the component renders the result.

```tsx
import { escapeHtml } from '../../utils';

interface WordPart {
  text: string;
  changed: boolean;
}

export function computeWordDiff(oldStr: string, newStr: string): { oldParts: WordPart[]; newParts: WordPart[] } {
  const oldWords = oldStr.match(/\S+|\s+/g) || [];
  const newWords = newStr.match(/\S+|\s+/g) || [];

  const m = oldWords.length;
  const n = newWords.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldWords[i - 1] === newWords[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  let i = m;
  let j = n;
  const oldParts: WordPart[] = [];
  const newParts: WordPart[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      oldParts.unshift({ text: oldWords[i - 1], changed: false });
      newParts.unshift({ text: newWords[j - 1], changed: false });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      newParts.unshift({ text: newWords[j - 1], changed: true });
      j--;
    } else {
      oldParts.unshift({ text: oldWords[i - 1], changed: true });
      i--;
    }
  }
  return { oldParts, newParts };
}

export function renderWordDiffHtml(parts: WordPart[], cls: string): string {
  return parts
    .map((p) => (p.changed ? `<span class="${cls}">${escapeHtml(p.text)}</span>` : escapeHtml(p.text)))
    .join('');
}
```

- [ ] **Step 2: Create `DiffLine.tsx`**

```tsx
import { createSignal, Show, For } from 'solid-js';
import { escapeHtml, highlightLine } from '../../utils';
import { comments, addLocalComment, updateLocalComment } from '../../state';
import { createComment as apiCreateComment } from '../../comment-api';
import type { Comment } from '../../comment-types';
import type { DiffLine as DiffLineType } from '../../state';
import CommentRow from '../comments/CommentRow';
import CommentTextarea from '../comments/CommentTextarea';

interface Props {
  line: DiffLineType;
  lineIdx: number;
  filePath: string;
  lang: string | null;
  /** Pre-rendered HTML for word diff highlighting. If provided, overrides syntax highlighting. */
  wordDiffHtml?: string;
}

export default function DiffLine(props: Props) {
  const [showNewComment, setShowNewComment] = createSignal(false);

  const cls = () => {
    if (props.line.type === 'add') return 'diff-add';
    if (props.line.type === 'del') return 'diff-del';
    return 'diff-context';
  };

  const prefix = () => {
    if (props.line.type === 'add') return '+';
    if (props.line.type === 'del') return '-';
    return ' ';
  };

  const codeHtml = () => {
    if (props.wordDiffHtml) return props.wordDiffHtml;
    if (props.lang) return `<code>${highlightLine(props.line.content, props.lang)}</code>`;
    return `<span class="diff-text">${escapeHtml(props.line.content)}</span>`;
  };

  const lineComments = () =>
    comments.list.filter(
      (c) =>
        c.item === 'diff' &&
        c.file === props.filePath &&
        c.line === props.lineIdx &&
        !c.parentId &&
        c.status !== 'dismissed',
    );

  function handleLineClick(e: MouseEvent) {
    // Don't trigger on clicks inside comment boxes
    if ((e.target as HTMLElement).closest('.comment-box') || (e.target as HTMLElement).closest('.claude-comment')) return;

    // If there's already a user comment, the CommentRow handles editing
    const existingUserComment = lineComments().find((c) => c.author === 'user' && c.mode === 'review');
    if (existingUserComment) return;

    setShowNewComment(true);
  }

  async function handleSaveNew(text: string) {
    const tempId = `temp-${Date.now()}`;
    const localComment: Comment = {
      id: tempId,
      author: 'user',
      text,
      status: 'active',
      item: 'diff',
      file: props.filePath,
      line: props.lineIdx,
      mode: 'review',
    };
    addLocalComment(localComment);
    setShowNewComment(false);
    try {
      const created = await apiCreateComment({
        author: 'user',
        text,
        item: 'diff',
        file: props.filePath,
        line: props.lineIdx,
        mode: 'review',
      });
      updateLocalComment(tempId, { id: created.id });
    } catch { /* optimistic update already applied */ }
  }

  return (
    <>
      <tr
        class={cls()}
        data-file={props.filePath}
        data-line-idx={props.lineIdx}
        id={`line-${props.filePath}-${props.lineIdx}`}
        onClick={handleLineClick}
      >
        <td class="line-num">{props.line.oldLine ?? ''}</td>
        <td class="line-num">{props.line.newLine ?? ''}</td>
        <td class="line-content">
          <span class="diff-prefix">{prefix()}</span>
          <span innerHTML={codeHtml()} />
        </td>
      </tr>

      <For each={lineComments()}>
        {(comment) => (
          <tr class={comment.author === 'claude' ? 'claude-comment-row' : 'comment-row'}>
            <td colspan="3">
              <div class="comment-box" style="max-width:calc(100vw - 360px)">
                <CommentRow comment={comment} />
              </div>
            </td>
          </tr>
        )}
      </For>

      <Show when={showNewComment()}>
        <tr class="comment-row">
          <td colspan="3">
            <CommentTextarea
              onSave={handleSaveNew}
              onCancel={() => setShowNewComment(false)}
            />
          </td>
        </tr>
      </Show>
    </>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/diff/
git commit -m "components: DiffLine and WordDiff — shared line renderer"
```

---

### Task 5: DiffView and WholeFileView components

**Files:**
- Create: `frontend/src/components/diff/DiffView.tsx`
- Create: `frontend/src/components/diff/WholeFileView.tsx`

- [ ] **Step 1: Create `DiffView.tsx`**

This is the main diff rendering component. It renders the diff table with hunk headers, context expansion and DiffLine components.

```tsx
import { For, Show, createMemo } from 'solid-js';
import { files, activeFileIdx, comments, analysis, wholeFileView, setWholeFileView } from '../../state';
import { fetchContext } from '../../api';
import { escapeHtml, detectLang, highlightLine } from '../../utils';
import type { DiffLine as DiffLineType } from '../../state';
import { computeWordDiff, renderWordDiffHtml } from './WordDiff';
import DiffLine from './DiffLine';
import CommentRow from '../comments/CommentRow';
import type { DiffFile, DiffLine as DiffLineType } from '../../state';
import WholeFileView from './WholeFileView';

function precomputeWordDiffs(lines: DiffLineType[]): Record<number, string> {
  const result: Record<number, string> = {};
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].type === 'del' && lines[i + 1].type === 'add') {
      const wd = computeWordDiff(lines[i].content, lines[i + 1].content);
      result[i] = renderWordDiffHtml(wd.oldParts, 'wdiff-del');
      result[i + 1] = renderWordDiffHtml(wd.newParts, 'wdiff-add');
    }
  }
  return result;
}

interface HunkInfo {
  lineIdx: number;
  line: DiffLineType;
  hunkNewStart: number;
  prevNewLine: number;
  gap: number;
  isSmallGap: boolean;
}

export default function DiffView() {
  const file = createMemo(() => files()[activeFileIdx()]);
  const lang = createMemo(() => file() ? detectLang(file()!.path) : null);
  const wordDiffs = createMemo(() => file() ? precomputeWordDiffs(file()!.lines) : {});

  const fileAnalysis = createMemo(() => {
    const f = file();
    const a = analysis();
    return f && a ? a.files[f.path] : undefined;
  });

  // Orphaned comments: comments whose lineIdx doesn't match any visible diff line
  const orphanedComments = createMemo(() => {
    const f = file();
    if (!f) return [];
    const visibleIdxs = new Set(f.lines.map((_, idx) => idx));
    return comments.list.filter(
      (c) =>
        c.item === 'diff' &&
        c.file === f.path &&
        c.line != null &&
        !c.parentId &&
        c.status !== 'dismissed' &&
        !visibleIdxs.has(c.line!),
    );
  });

  return (
    <Show when={file()}>
      {(f) => (
        <Show when={!wholeFileView()} fallback={<WholeFileView />}>
          <div class="diff-file-header">
            {escapeHtml(f().path)}{' '}
            <a
              style="float:right;font-size:11px;font-weight:400;color:var(--accent);cursor:pointer;text-decoration:none"
              onClick={() => setWholeFileView(true)}
            >
              Show whole file
            </a>
            <Show when={fileAnalysis()}>
              {(fa) => <div class="file-header-summary">{escapeHtml(fa().summary)}</div>}
            </Show>
          </div>
          <table class="diff-table">
            <For each={f().lines}>
              {(line, lineIdx) => (
                <Show
                  when={line.type !== 'hunk'}
                  fallback={<HunkRow file={f()} line={line} lineIdx={lineIdx()} />}
                >
                  <DiffLine
                    line={line}
                    lineIdx={lineIdx()}
                    filePath={f().path}
                    lang={lang()}
                    wordDiffHtml={wordDiffs()[lineIdx()]}
                  />
                </Show>
              )}
            </For>
            {/* Orphaned comments rendered at end */}
            <For each={orphanedComments()}>
              {(comment) => (
                <tr class={comment.author === 'claude' ? 'claude-comment-row' : 'comment-row'}>
                  <td colspan="3">
                    <div class="comment-box" style="max-width:calc(100vw - 360px)">
                      <CommentRow comment={{ ...comment, text: `[line ${comment.line}] ${comment.text}` }} />
                    </div>
                  </td>
                </tr>
              )}
            </For>
          </table>
        </Show>
      )}
    </Show>
  );
}

// Hunk separator row with context expansion
function HunkRow(props: { file: DiffFile; line: DiffLineType; lineIdx: number }) {
  // Compute gap info for auto-expand / expand-up
  const hunkMatch = () => props.line.content.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
  const hunkNewStart = () => hunkMatch() ? parseInt(hunkMatch()![2]) : 0;

  const prevNewLine = () => {
    for (let i = props.lineIdx - 1; i >= 0; i--) {
      if (props.file.lines[i].newLine != null) return props.file.lines[i].newLine!;
    }
    return 0;
  };

  const gap = () => hunkNewStart() - prevNewLine() - 1;
  const isSmallGap = () => prevNewLine() > 0 && gap() > 0 && gap() <= 8;

  async function expandContext(lineNum: number, direction: string, rowEl: HTMLElement, count = 20) {
    try {
      const lines = await fetchContext(props.file.path, lineNum, count, direction);
      if (lines.length === 0) { rowEl.remove(); return; }
      const fileLang = detectLang(props.file.path);
      let html = '';
      for (const l of lines) {
        const highlighted = fileLang
          ? `<code>${highlightLine(l.content, fileLang)}</code>`
          : `<span class="diff-text">${escapeHtml(l.content)}</span>`;
        html += `<tr class="diff-context">
          <td class="line-num">${l.num}</td>
          <td class="line-num">${l.num}</td>
          <td class="line-content"><span class="diff-prefix"> </span>${highlighted}</td>
        </tr>`;
      }
      const temp = document.createElement('tbody');
      temp.innerHTML = html;
      const rows = Array.from(temp.children);
      if (direction === 'up') {
        for (const row of rows) rowEl.before(row);
      } else {
        let after: Element = rowEl;
        for (const row of rows) { after.after(row); after = row; }
      }
      rowEl.remove();
    } catch { /* ignore */ }
  }

  return (
    <>
      <Show when={isSmallGap()}>
        <tr class="expand-row">
          <td colspan="3" style="color:var(--text-muted)">
            &#8943; {gap()} line{gap() !== 1 ? 's' : ''} hidden
          </td>
        </tr>
      </Show>
      <Show when={!isSmallGap() && hunkNewStart() > 1}>
        <tr class="expand-row">
          <td colspan="3">&#8943; Show more context above</td>
        </tr>
      </Show>
      <tr class="diff-hunk">
        <td class="line-num" />
        <td class="line-num" />
        <td class="line-content">{escapeHtml(props.line.content)}</td>
      </tr>
    </>
  );
}
```

- [ ] **Step 2: Create `WholeFileView.tsx`**

This reuses `DiffLine` — which means commenting works for free.

```tsx
import { createSignal, createResource, For, Show, createMemo } from 'solid-js';
import { files, activeFileIdx, setWholeFileView } from '../../state';
import { fetchFile } from '../../api';
import { escapeHtml, detectLang } from '../../utils';
import DiffLine from './DiffLine';
import type { DiffLine as DiffLineType } from '../../state';

export default function WholeFileView() {
  const file = createMemo(() => files()[activeFileIdx()]);
  const lang = createMemo(() => file() ? detectLang(file()!.path) : null);

  const [wholeFileLines] = createResource(
    () => file()?.path,
    async (path) => {
      if (!path) return [];
      return fetchFile(path);
    },
  );

  // Track which line numbers are additions in the diff
  const addLines = createMemo(() => {
    const f = file();
    if (!f) return new Set<number>();
    const set = new Set<number>();
    for (const line of f.lines) {
      if (line.type === 'add' && line.newLine) set.add(line.newLine);
    }
    return set;
  });

  // Convert whole-file lines to DiffLine format so DiffLine component can render them
  const asDiffLines = createMemo((): { line: DiffLineType; lineIdx: number }[] => {
    const lines = wholeFileLines();
    if (!lines) return [];
    return lines.map((l) => ({
      line: {
        type: addLines().has(l.num) ? 'add' as const : 'context' as const,
        content: l.content,
        oldLine: l.num,
        newLine: l.num,
      },
      lineIdx: l.num, // Use absolute line number as lineIdx for whole-file view
    }));
  });

  return (
    <Show when={file()}>
      {(f) => (
        <>
          <div class="diff-file-header">
            {escapeHtml(f().path)}{' '}
            <a
              style="float:right;font-size:11px;font-weight:400;color:var(--accent);cursor:pointer"
              onClick={() => setWholeFileView(false)}
            >
              Back to diff
            </a>
          </div>
          <Show when={wholeFileLines()} fallback={<div class="empty-state">Loading...</div>}>
            <table class="diff-table">
              <For each={asDiffLines()}>
                {(item) => (
                  <DiffLine
                    line={item.line}
                    lineIdx={item.lineIdx}
                    filePath={f().path}
                    lang={lang()}
                  />
                )}
              </For>
            </table>
          </Show>
        </>
      )}
    </Show>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/diff/DiffView.tsx frontend/src/components/diff/WholeFileView.tsx
git commit -m "components: DiffView and WholeFileView with shared DiffLine"
```

---

### Task 6: Sidebar components — FileList, FileSearch, ViewToggle

**Files:**
- Create: `frontend/src/components/sidebar/Sidebar.tsx`
- Create: `frontend/src/components/sidebar/FileList.tsx`
- Create: `frontend/src/components/sidebar/FileSearch.tsx`
- Create: `frontend/src/components/sidebar/ViewToggle.tsx`

- [ ] **Step 1: Create `FileSearch.tsx`**

```tsx
import { createSignal } from 'solid-js';

interface Props {
  onFilter: (query: string) => void;
}

export default function FileSearch(props: Props) {
  let inputRef!: HTMLInputElement;

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      inputRef.value = '';
      props.onFilter('');
      inputRef.blur();
    } else if (e.key === 'Enter') {
      inputRef.blur();
    }
  }

  // Expose focus for keyboard shortcut
  (window as any).__focusFileSearch = () => inputRef?.focus();

  return (
    <div class="sidebar-search">
      <input
        ref={inputRef}
        type="text"
        id="file-search"
        placeholder="Filter files... (f)"
        autocomplete="off"
        onInput={(e) => props.onFilter(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create `ViewToggle.tsx`**

```tsx
import { Show, For } from 'solid-js';
import { analysis, sidebarView, setSidebarView } from '../../state';
import type { SidebarView } from '../../state';

const VIEWS: { id: SidebarView; label: string }[] = [
  { id: 'flat', label: 'Flat' },
  { id: 'grouped', label: 'Grouped' },
  { id: 'phased', label: 'Phased' },
];

export default function ViewToggle() {
  return (
    <Show when={analysis()}>
      <div class="view-toggle" id="view-toggle">
        <For each={VIEWS}>
          {(view) => (
            <button
              class="view-btn"
              classList={{ active: sidebarView() === view.id }}
              data-view={view.id}
              onClick={() => setSidebarView(view.id)}
            >
              {view.label}
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
```

- [ ] **Step 3: Create `FileList.tsx`**

This handles flat, grouped and phased views. The longest component but structurally clear.

```tsx
import { For, Show, createMemo, createSignal } from 'solid-js';
import {
  files,
  activeFileIdx,
  setActiveFileIdx,
  setWholeFileView,
  comments,
  reviewedFiles,
  toggleReviewed,
  analysis,
  sidebarView,
  userCommentCount,
} from '../../state';
import type { DiffFile } from '../../state';
import { escapeHtml } from '../../utils';
import { sortFilesByPriority, groupFiles, phaseFiles } from '../../analysis';

interface FileItemProps {
  file: DiffFile;
  idx: number;
  showDir?: boolean;
  showSummary?: boolean;
  priorityClass?: string;
  extraClass?: string;
}

function FileItem(props: FileItemProps) {
  const isActive = () => activeFileIdx() === props.idx;
  const isReviewed = () => reviewedFiles[props.file.path] ?? false;

  const fileComments = createMemo(() =>
    comments.list.filter(
      (c) => c.file === props.file.path && !c.parentId && c.status !== 'dismissed',
    ),
  );
  const userCount = () => fileComments().filter((c) => c.author === 'user').length;
  const claudeCount = () => fileComments().filter((c) => c.author === 'claude').length;

  const lastSlash = () => props.file.path.lastIndexOf('/');
  const dir = () => (lastSlash() >= 0 ? props.file.path.slice(0, lastSlash() + 1) : '');
  const base = () => (lastSlash() >= 0 ? props.file.path.slice(lastSlash() + 1) : props.file.path);
  const fileSummary = () =>
    props.showSummary ? analysis()?.files[props.file.path]?.summary : undefined;

  function handleSelect() {
    setActiveFileIdx(props.idx);
    setWholeFileView(false);
    window.location.hash = 'file=' + encodeURIComponent(props.file.path);
  }

  return (
    <div
      class={`file-item${isActive() ? ' active' : ''}${isReviewed() ? ' reviewed' : ''}${props.extraClass ? ' ' + props.extraClass : ''}${props.priorityClass ? ' ' + props.priorityClass : ''}`}
      data-idx={props.idx}
      onClick={handleSelect}
    >
      <span
        class="review-check"
        title="Mark as reviewed (e)"
        onClick={(e) => { e.stopPropagation(); toggleReviewed(props.file.path); }}
      >
        {isReviewed() ? '\u2713' : '\u25CB'}
      </span>
      <span class="filename" title={props.file.path}>
        <Show when={props.showDir && dir()}>
          <span class="dir">{dir()}</span>
        </Show>
        <span class="base">{base()}</span>
        <Show when={fileSummary()}>
          <span class="file-summary">{fileSummary()}</span>
        </Show>
      </span>
      <Show when={claudeCount() > 0}>
        <span class="badge claude-badge" title="Claude comments">{claudeCount()}</span>
      </Show>
      <Show when={userCount() > 0}>
        <span class="badge comments-badge" title="Your comments">{userCount()}</span>
      </Show>
      <span class="file-stats">
        <span class="add">+{props.file.additions}</span>
        <span class="del">-{props.file.deletions}</span>
      </span>
    </div>
  );
}

// --- Flat view ---

function FlatFileList() {
  const displayFiles = createMemo(() => {
    const a = analysis();
    return a && sidebarView() === 'flat' ? sortFilesByPriority(files(), a) : files();
  });

  return (
    <For each={displayFiles()}>
      {(file) => {
        const idx = () => files().indexOf(file);
        const priority = () => analysis()?.files[file.path]?.priority;
        return (
          <FileItem
            file={file}
            idx={idx()}
            showDir
            showSummary
            priorityClass={priority() ? `priority-${priority()}` : undefined}
          />
        );
      }}
    </For>
  );
}

// --- Grouped view ---

function GroupedFileList() {
  const groups = createMemo(() => {
    const a = analysis();
    return a ? groupFiles(files(), a) : [];
  });

  return (
    <For each={groups()}>
      {(group) => {
        const hasHighPriority = () =>
          group.files.some((f) => {
            const p = analysis()?.files[f.path]?.priority;
            return p === 'critical' || p === 'important';
          });
        const [expanded, setExpanded] = createSignal(hasHighPriority());
        const totalAdd = () => group.files.reduce((s, f) => s + f.additions, 0);
        const totalDel = () => group.files.reduce((s, f) => s + f.deletions, 0);

        return (
          <>
            <div class="group-header" onClick={() => setExpanded(!expanded())}>
              <div class="group-header-left">
                <span class="group-chevron">{expanded() ? '\u25BE' : '\u25B8'}</span>
                <span class="group-name">{group.name}</span>
                <span class="group-count">
                  {group.files.length} file{group.files.length !== 1 ? 's' : ''}
                </span>
                <Show when={group.description}>
                  <span class="group-desc">{group.description}</span>
                </Show>
              </div>
              <div class="group-stats">
                <span class="add">+{totalAdd()}</span>
                <span class="del">-{totalDel()}</span>
              </div>
            </div>
            <Show when={expanded()}>
              <div class="group-files">
                <For each={group.files}>
                  {(file) => {
                    const idx = () => files().indexOf(file);
                    const priority = () => analysis()?.files[file.path]?.priority;
                    return (
                      <FileItem
                        file={file}
                        idx={idx()}
                        extraClass="grouped"
                        priorityClass={priority() ? `priority-${priority()}` : undefined}
                      />
                    );
                  }}
                </For>
              </div>
            </Show>
          </>
        );
      }}
    </For>
  );
}

// --- Phased view ---

const PHASE_CONFIG = {
  review: { label: 'Review carefully', color: '#f85149', icon: '\u2B24' },
  skim: { label: 'Skim', color: '#d29922', icon: '\u25D0' },
  'rubber-stamp': { label: 'Rubber stamp', color: '#8b949e', icon: '\u25CB' },
} as const;

function PhasedFileList() {
  const phases = createMemo(() => {
    const a = analysis();
    return a ? phaseFiles(files(), a) : { review: [], skim: [], 'rubber-stamp': [] };
  });

  return (
    <For each={(['review', 'skim', 'rubber-stamp'] as const).filter((p) => phases()[p].length > 0)}>
      {(phase) => {
        const phaseFiles_ = () => phases()[phase];
        const config = PHASE_CONFIG[phase];
        const reviewedCount = () => phaseFiles_().filter((f) => reviewedFiles[f.path]).length;
        const pct = () => Math.round((reviewedCount() / phaseFiles_().length) * 100);

        return (
          <>
            <div class="phase-header">
              <div class="phase-header-top">
                <span class="phase-label" style={`color: ${config.color}`}>
                  {config.icon} {config.label}
                </span>
                <span class="phase-progress-text">
                  {reviewedCount()} / {phaseFiles_().length} reviewed
                </span>
              </div>
              <div class="phase-progress-bar">
                <div
                  class="phase-progress-fill"
                  style={`width: ${pct()}%; background: ${config.color}`}
                />
              </div>
            </div>
            <For each={phaseFiles_()}>
              {(file) => {
                const idx = () => files().indexOf(file);
                return <FileItem file={file} idx={idx()} extraClass="phased" />;
              }}
            </For>
          </>
        );
      }}
    </For>
  );
}

// --- Main FileList ---

export default function FileList() {
  return (
    <div class="file-list" id="file-list">
      <Show when={analysis() && sidebarView() === 'grouped'}>
        <GroupedFileList />
      </Show>
      <Show when={analysis() && sidebarView() === 'phased'}>
        <PhasedFileList />
      </Show>
      <Show when={!analysis() || sidebarView() === 'flat'}>
        <FlatFileList />
      </Show>
    </div>
  );
}
```

- [ ] **Step 4: Create `Sidebar.tsx`**

```tsx
import { createSignal } from 'solid-js';
import FileSearch from './FileSearch';
import ViewToggle from './ViewToggle';
import FileList from './FileList';

export default function Sidebar() {
  const [filterQuery, setFilterQuery] = createSignal('');

  // File filtering is handled via CSS class toggling on FileList items
  // For now, filter query is passed down and FileList applies it
  // TODO: integrate filter query into FileList's rendering

  return (
    <div class="sidebar">
      <div class="sidebar-controls">
        <ViewToggle />
        <FileSearch onFilter={setFilterQuery} />
      </div>
      <FileList />
    </div>
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/sidebar/
git commit -m "components: sidebar with file list, search, view toggle"
```

---

### Task 7: Header, TabBar, CommitPanel, OverviewBanner

**Files:**
- Create: `frontend/src/components/header/Header.tsx`
- Create: `frontend/src/components/tabs/TabBar.tsx`
- Create: `frontend/src/components/tabs/FilePicker.tsx`
- Create: `frontend/src/components/commits/CommitPanel.tsx`
- Create: `frontend/src/components/overview/OverviewBanner.tsx`

- [ ] **Step 1: Create `Header.tsx`**

```tsx
import { Show, createMemo } from 'solid-js';
import { repoMeta, files, reviewedFiles, comments, userCommentCount } from '../../state';
import { escapeHtml } from '../../utils';

interface Props {
  onRefresh: () => void;
  onSubmit: () => void;
  onToggleCommits: () => void;
  showCommitToggle: boolean;
}

export default function Header(props: Props) {
  const meta = repoMeta;

  const totalAdd = createMemo(() => files().reduce((s, f) => s + f.additions, 0));
  const totalDel = createMemo(() => files().reduce((s, f) => s + f.deletions, 0));
  const reviewedCount = createMemo(() => files().filter((f) => reviewedFiles[f.path]).length);
  const remainingLines = createMemo(() =>
    files()
      .filter((f) => !reviewedFiles[f.path])
      .reduce((s, f) => s + f.additions, 0),
  );

  return (
    <header>
      <h1>
        <strong>{meta().repoName || 'Code Review'}</strong>{' '}
        <Show when={meta().branch}>
          <span class="header-branch">
            {meta().branch} → {meta().baseBranch || 'main'}
          </span>
        </Show>
        <Show when={meta().pr}>
          {(pr) => (
            <a class="header-pr" href={pr().url} target="_blank">
              PR #{pr().number}
            </a>
          )}
        </Show>
      </h1>
      <div class="stats" id="stats">
        {files().length} file{files().length !== 1 ? 's' : ''} &middot;{' '}
        <span class="add">+{totalAdd()}</span>{' '}
        <span class="del">-{totalDel()}</span>
        <Show when={reviewedCount() === files().length && files().length > 0}>
          {' '}&middot; All files reviewed
        </Show>
        <Show when={reviewedCount() < files().length && remainingLines() > 0}>
          {' '}&middot; {remainingLines()} line{remainingLines() !== 1 ? 's' : ''} to review
        </Show>
        <Show when={userCommentCount() > 0}>
          {' '}&middot; {userCommentCount()} comment{userCommentCount() !== 1 ? 's' : ''}
        </Show>
      </div>
      <div class="header-actions">
        <Show when={props.showCommitToggle}>
          <div class="commit-toggle" id="commit-toggle-wrap">
            <button class="header-btn" onClick={props.onToggleCommits}>
              Commits
            </button>
          </div>
        </Show>
        <button class="header-btn" onClick={props.onRefresh}>
          Refresh
        </button>
        <button id="submit-btn" onClick={props.onSubmit}>
          Submit Review
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Create `TabBar.tsx`**

```tsx
import { For, Show, createSignal } from 'solid-js';
import { sessionItems, activeItemId, comments } from '../../state';
import { escapeHtml } from '../../utils';
import type { Comment } from '../../comment-types';
import FilePicker from './FilePicker';

interface Props {
  onSwitchItem: (itemId: string) => void;
  onCloseTab: (itemId: string) => void;
}

export default function TabBar(props: Props) {
  const [showPicker, setShowPicker] = createSignal(false);

  function badgeCounts(itemId: string) {
    const itemComments = comments.list.filter((c: Comment) => c._item === itemId || c.item === itemId);
    const claude = itemComments.filter((c) => c.author === 'claude' && !c.parentId).length;
    const user = itemComments.filter((c) => c.author === 'user' && !c.parentId).length;
    return { claude, user };
  }

  return (
    <div class="tab-bar" id="tab-bar">
      <For each={sessionItems()}>
        {(item) => {
          const counts = () => badgeCounts(item.id);
          return (
            <div
              class="tab-item"
              classList={{ active: activeItemId() === item.id }}
              onClick={() => props.onSwitchItem(item.id)}
            >
              <span class="tab-title">{item.title}</span>
              <Show when={counts().claude > 0}>
                <span class="tab-badge claude">{counts().claude}</span>
              </Show>
              <Show when={counts().user > 0}>
                <span class="tab-badge user">{counts().user}</span>
              </Show>
              <Show when={item.id !== 'diff'}>
                <span
                  class="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onCloseTab(item.id);
                  }}
                >
                  &times;
                </span>
              </Show>
            </div>
          );
        }}
      </For>
      <div
        class="tab-item tab-add"
        onClick={(e) => {
          e.stopPropagation();
          setShowPicker(!showPicker());
        }}
      >
        +
      </div>
      <Show when={showPicker()}>
        <FilePicker onClose={() => setShowPicker(false)} onSelect={(path) => setShowPicker(false)} />
      </Show>
    </div>
  );
}
```

- [ ] **Step 3: Create `FilePicker.tsx`**

```tsx
import { createSignal, createResource, For, Show, onMount, onCleanup } from 'solid-js';
import { fetchRepoFiles } from '../../api';
import { sessionItems } from '../../state';

interface Props {
  onClose: () => void;
  onSelect: (filepath: string) => void;
}

export default function FilePicker(props: Props) {
  let inputRef!: HTMLInputElement;
  let pickerRef!: HTMLDivElement;
  const [query, setQuery] = createSignal('');

  const [allFiles] = createResource(async () => {
    try {
      return await fetchRepoFiles('**/*.md');
    } catch {
      return [];
    }
  });

  const existingPaths = () => new Set(sessionItems().filter((i) => i.path).map((i) => i.path));

  const filtered = () => {
    const q = query().toLowerCase();
    const files = allFiles() || [];
    return files
      .filter((f) => !existingPaths().has(f) && (!q || f.toLowerCase().includes(q)))
      .slice(0, 20);
  };

  function handleClickOutside(e: Event) {
    if (pickerRef && !pickerRef.contains(e.target as Node)) {
      props.onClose();
    }
  }

  onMount(() => {
    inputRef.focus();
    setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
  });

  onCleanup(() => document.removeEventListener('click', handleClickOutside));

  return (
    <div id="file-picker" ref={pickerRef}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Filter files..."
        autocomplete="off"
        onInput={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose();
          if (e.key === 'Enter') {
            const first = filtered()[0];
            if (first) props.onSelect(first);
          }
        }}
      />
      <div id="file-picker-list">
        <Show when={filtered().length === 0}>
          <div class="file-picker-empty">No matching files</div>
        </Show>
        <For each={filtered()}>
          {(file) => (
            <div class="file-picker-row" onClick={() => props.onSelect(file)}>
              {file}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `CommitPanel.tsx`**

```tsx
import { For, Show, createSignal, createMemo } from 'solid-js';
import { allCommits, selectedShas, setSelectedShas } from '../../state';
import { escapeHtml } from '../../utils';

interface Props {
  visible: boolean;
  onApply: () => void;
}

export default function CommitPanel(props: Props) {
  const selectedCount = createMemo(() =>
    allCommits().filter((c) => selectedShas[c.sha]).length,
  );

  function selectAll() {
    for (const c of allCommits()) setSelectedShas(c.sha, true);
  }

  function selectNone() {
    for (const c of allCommits()) setSelectedShas(c.sha, false);
  }

  return (
    <div class="commit-panel" classList={{ open: props.visible }}>
      <div class="commit-actions">
        <a onClick={selectAll}>Select all</a>
        <a onClick={selectNone}>Select none</a>
        <a onClick={props.onApply}>Apply</a>
      </div>
      <div class="commit-list">
        <For each={allCommits()}>
          {(c) => (
            <label class="commit-item">
              <input
                type="checkbox"
                checked={selectedShas[c.sha] ?? false}
                onChange={(e) => setSelectedShas(c.sha, e.currentTarget.checked)}
              />
              <span class="commit-sha">{c.sha.slice(0, 7)}</span>
              <span class="commit-msg" title={c.message}>
                {c.message}
              </span>
              <span class="commit-date">{c.date}</span>
            </label>
          )}
        </For>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `OverviewBanner.tsx`**

```tsx
import { Show, createSignal, onMount } from 'solid-js';
import { analysis } from '../../state';

export default function OverviewBanner() {
  const [collapsed, setCollapsed] = createSignal(
    localStorage.getItem('lgtm-overview-collapsed') === 'true',
  );

  function toggle() {
    const next = !collapsed();
    setCollapsed(next);
    localStorage.setItem('lgtm-overview-collapsed', String(next));
  }

  return (
    <Show when={analysis()}>
      {(a) => (
        <div class="overview-banner" classList={{ collapsed: collapsed() }}>
          <div class="overview-content">
            <div class="overview-text">{a().overview}</div>
            <div class="overview-strategy">{a().reviewStrategy}</div>
          </div>
          <button class="overview-toggle" title="Toggle overview" onClick={toggle}>
            &#9650;
          </button>
        </div>
      )}
    </Show>
  );
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/header/ frontend/src/components/tabs/ frontend/src/components/commits/ frontend/src/components/overview/
git commit -m "components: header, tab bar, file picker, commit panel, overview banner"
```

---

### Task 8: DocumentView component

**Files:**
- Create: `frontend/src/components/document/DocumentView.tsx`

- [ ] **Step 1: Create `DocumentView.tsx`**

```tsx
import { createSignal, For, Show, createMemo } from 'solid-js';
import { comments, activeItemId, mdMeta, addLocalComment } from '../../state';
import { renderMd } from '../../utils';
import { createComment as apiCreateComment } from '../../comment-api';
import type { Comment } from '../../comment-types';
import CommentRow from '../comments/CommentRow';
import CommentTextarea from '../comments/CommentTextarea';

export default function DocumentView() {
  const content = createMemo(() => mdMeta().content || '');

  // Parse markdown into blocks (top-level HTML elements)
  const blocks = createMemo(() => {
    const rawHtml = renderMd(content());
    const temp = document.createElement('div');
    temp.innerHTML = rawHtml;
    return Array.from(temp.children).map((child, idx) => ({
      html: child.outerHTML,
      idx,
    }));
  });

  const totalComments = createMemo(() =>
    comments.list.filter(
      (c) => c.item === activeItemId() && !c.parentId && c.status !== 'dismissed',
    ).length,
  );

  return (
    <div class="md-content">
      <div id="stats">
        {mdMeta().filename || 'Document'}
        <Show when={totalComments() > 0}>
          {' '}&middot; {totalComments()} comment{totalComments() !== 1 ? 's' : ''}
        </Show>
      </div>
      <For each={blocks()}>
        {(block) => <DocumentBlock html={block.html} blockIdx={block.idx} />}
      </For>
    </div>
  );
}

function DocumentBlock(props: { html: string; blockIdx: number }) {
  const [showNewComment, setShowNewComment] = createSignal(false);

  const blockComments = createMemo(() =>
    comments.list.filter(
      (c) =>
        c.item === activeItemId() &&
        c.block === props.blockIdx &&
        !c.parentId &&
        c.status !== 'dismissed',
    ),
  );

  function handleBlockClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.comment-box') || (e.target as HTMLElement).closest('.reply-textarea-wrap')) return;

    // If user already has a comment, don't open a new one
    const existingUser = blockComments().find((c) => c.author === 'user' && c.mode === 'review');
    if (existingUser) return;

    setShowNewComment(true);
  }

  async function handleSave(text: string) {
    const comment = await apiCreateComment({
      author: 'user',
      text,
      item: activeItemId(),
      block: props.blockIdx,
      mode: 'review',
    });
    addLocalComment(comment);
    setShowNewComment(false);
  }

  return (
    <>
      <div
        class="md-block"
        classList={{ 'has-comment': blockComments().length > 0 }}
        id={`md-block-${activeItemId()}-${props.blockIdx}`}
        data-block={props.blockIdx}
        onClick={handleBlockClick}
        innerHTML={props.html}
      />
      <For each={blockComments()}>
        {(comment) => (
          <div class="md-comment" style="margin:4px 0">
            <div class="comment-box" style="max-width:100%">
              <CommentRow comment={comment} />
            </div>
          </div>
        )}
      </For>
      <Show when={showNewComment()}>
        <div class="md-comment">
          <CommentTextarea
            onSave={handleSave}
            onCancel={() => setShowNewComment(false)}
          />
        </div>
      </Show>
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/document/
git commit -m "components: document view with block commenting"
```

---

### Task 9: Extract format-comments as pure functions + tests

**Files:**
- Create: `frontend/src/format-comments.ts`
- Create: `frontend/src/__tests__/format-comments.test.ts`

The current `formatAllComments` in `comments.ts` reads from DOM for block previews. Extract it as pure functions that receive data as arguments.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { formatDiffComments, formatClaudeInteractions } from '../format-comments';
import type { Comment } from '../comment-types';
import type { DiffFile } from '../state';

const SAMPLE_FILE: DiffFile = {
  path: 'src/app.ts',
  additions: 2,
  deletions: 1,
  lines: [
    { type: 'context', content: 'import foo', oldLine: 1, newLine: 1 },
    { type: 'del', content: 'const old = 1', oldLine: 2, newLine: null },
    { type: 'add', content: 'const new1 = 1', oldLine: null, newLine: 2 },
    { type: 'add', content: 'const new2 = 2', oldLine: null, newLine: 3 },
  ],
};

describe('formatDiffComments', () => {
  it('formats user review comments grouped by file', () => {
    const comments: Comment[] = [
      { id: '1', author: 'user', text: 'Why this change?', status: 'active', item: 'diff', file: 'src/app.ts', line: 2, mode: 'review' },
    ];
    const result = formatDiffComments(comments, [SAMPLE_FILE]);
    expect(result).toContain('## src/app.ts');
    expect(result).toContain('Why this change?');
    expect(result).toContain('Line 2');
  });

  it('excludes replies and dismissed comments', () => {
    const comments: Comment[] = [
      { id: '1', author: 'user', text: 'visible', status: 'active', item: 'diff', file: 'src/app.ts', line: 2, mode: 'review' },
      { id: '2', author: 'user', text: 'reply', status: 'active', item: 'diff', file: 'src/app.ts', line: 2, parentId: '1' },
      { id: '3', author: 'user', text: 'dismissed', status: 'dismissed', item: 'diff', file: 'src/app.ts', line: 3, mode: 'review' },
    ];
    const result = formatDiffComments(comments, [SAMPLE_FILE]);
    expect(result).toContain('visible');
    expect(result).not.toContain('reply');
    expect(result).not.toContain('dismissed');
  });

  it('returns empty string when no comments', () => {
    expect(formatDiffComments([], [SAMPLE_FILE])).toBe('');
  });
});

describe('formatClaudeInteractions', () => {
  it('formats claude comments with user replies', () => {
    const comments: Comment[] = [
      { id: 'c1', author: 'claude', text: 'Consider renaming', status: 'active', item: 'diff', file: 'src/app.ts', line: 2 },
      { id: 'r1', author: 'user', text: 'Good point', status: 'active', item: 'diff', file: 'src/app.ts', line: 2, parentId: 'c1' },
    ];
    const result = formatClaudeInteractions(comments);
    expect(result).toContain('**Claude:** Consider renaming');
    expect(result).toContain('**Reply:** Good point');
  });

  it('formats resolved claude comments', () => {
    const comments: Comment[] = [
      { id: 'c1', author: 'claude', text: 'Fix this', status: 'resolved', item: 'diff', file: 'src/app.ts', line: 2 },
    ];
    const result = formatClaudeInteractions(comments);
    expect(result).toContain('**Status:** Resolved');
  });

  it('skips claude comments with no reply and not resolved', () => {
    const comments: Comment[] = [
      { id: 'c1', author: 'claude', text: 'Ignored', status: 'active', item: 'diff', file: 'src/app.ts', line: 2 },
    ];
    const result = formatClaudeInteractions(comments);
    expect(result).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/format-comments.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `format-comments.ts`**

```ts
import type { Comment } from './comment-types';
import type { DiffFile } from './state';
import type { SessionItem } from './state';

export function formatDiffComments(comments: Comment[], files: DiffFile[]): string {
  const byFile: Record<string, { lineNum: number | string; lineType: string; lineContent: string; comment: string }[]> = {};

  const diffUserComments = comments.filter(
    (c) => c.author === 'user' && c.item === 'diff' && c.file && c.line != null && !c.parentId && c.mode === 'review' && c.status !== 'dismissed',
  );

  for (const c of diffUserComments) {
    const filePath = c.file!;
    if (!byFile[filePath]) byFile[filePath] = [];
    const file = files.find((f) => f.path === filePath);
    const line = file?.lines[c.line!];
    byFile[filePath].push({
      lineNum: line?.newLine ?? line?.oldLine ?? '?',
      lineType: line?.type ?? 'context',
      lineContent: line?.content ?? '',
      comment: c.text,
    });
  }

  let output = '';
  for (const [filePath, fileComments] of Object.entries(byFile)) {
    output += `## ${filePath}\n\n`;
    for (const fc of fileComments.sort((a, b) => Number(a.lineNum) - Number(b.lineNum))) {
      const prefix = fc.lineType === 'add' ? '+' : fc.lineType === 'del' ? '-' : ' ';
      output += `Line ${fc.lineNum}: \`${prefix}${fc.lineContent.trim()}\`\n`;
      output += `> ${fc.comment}\n\n`;
    }
  }
  return output;
}

export function formatClaudeInteractions(comments: Comment[]): string {
  const byFile: Record<string, { lineNum: number | string; comment: string; reply?: string; resolved: boolean }[]> = {};

  const claudeDiffComments = comments.filter(
    (c) => c.author === 'claude' && c.item === 'diff' && c.file != null && !c.parentId,
  );

  for (const cc of claudeDiffComments) {
    const replies = comments.filter((r) => r.parentId === cc.id);
    const reply = replies.find((r) => r.author === 'user');
    const resolved = cc.status === 'resolved';

    if (!reply && !resolved) continue;

    const filePath = cc.file!;
    if (!byFile[filePath]) byFile[filePath] = [];
    byFile[filePath].push({
      lineNum: cc.line ?? '?',
      comment: cc.text,
      reply: reply?.text,
      resolved,
    });
  }

  let output = '';
  for (const [filePath, interactions] of Object.entries(byFile)) {
    output += `## ${filePath}\n\n`;
    for (const c of interactions.sort((a, b) => Number(a.lineNum) - Number(b.lineNum))) {
      output += `**Claude:** ${c.comment}\n`;
      if (c.reply) {
        output += `**Reply:** ${c.reply}\n`;
      } else if (c.resolved) {
        output += `**Status:** Resolved\n`;
      }
      output += '\n';
    }
  }
  return output;
}

export function formatDocComments(comments: Comment[], items: SessionItem[], blockPreviews: Record<string, string>): string {
  let output = '';
  for (const item of items) {
    if (item.id === 'diff') continue;

    const docUserComments = comments.filter(
      (c) => c.author === 'user' && c.item === item.id && c.block != null && !c.parentId && c.status !== 'dismissed',
    );

    if (docUserComments.length === 0) continue;
    output += `## ${item.title}\n\n`;

    const sorted = docUserComments.sort((a, b) => (a.block ?? 0) - (b.block ?? 0));
    for (const c of sorted) {
      const key = `${item.id}-${c.block}`;
      const preview = blockPreviews[key] || `Block ${c.block}`;
      output += `**${preview}${preview.length >= 80 ? '...' : ''}**\n`;
      output += `> ${c.text}\n\n`;
    }
  }
  return output;
}

export function formatDocClaudeInteractions(comments: Comment[], items: SessionItem[]): string {
  let output = '';
  for (const item of items) {
    if (item.id === 'diff') continue;
    const itemClaudeComments = comments.filter(
      (c) => c.author === 'claude' && c.item === item.id && !c.parentId,
    );
    const interactions: { block: number; comment: string; reply?: string; resolved: boolean }[] = [];

    for (const cc of itemClaudeComments) {
      const replies = comments.filter((r) => r.parentId === cc.id);
      const reply = replies.find((r) => r.author === 'user');
      const resolved = cc.status === 'resolved';
      if (!reply && !resolved) continue;
      interactions.push({ block: cc.block ?? 0, comment: cc.text, reply: reply?.text, resolved });
    }

    if (interactions.length === 0) continue;
    output += `## ${item.title}\n\n`;
    for (const c of interactions.sort((a, b) => a.block - b.block)) {
      output += `**Claude:** ${c.comment}\n`;
      if (c.reply) output += `**Reply:** ${c.reply}\n`;
      else if (c.resolved) output += `**Status:** Resolved\n`;
      output += '\n';
    }
  }
  return output;
}

export function formatAllComments(
  comments: Comment[],
  files: DiffFile[],
  items: SessionItem[],
  blockPreviews: Record<string, string>,
): string {
  let output = '';

  const diffOutput = formatDiffComments(comments, files);
  if (diffOutput) output += diffOutput;

  const claudeDiffOutput = formatClaudeInteractions(comments);
  if (claudeDiffOutput) output += claudeDiffOutput;

  const docOutput = formatDocComments(comments, items, blockPreviews);
  if (docOutput) output += docOutput;

  const claudeDocOutput = formatDocClaudeInteractions(comments, items);
  if (claudeDocOutput) output += claudeDocOutput;

  return output || 'No comments (LGTM).';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/format-comments.test.ts`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/format-comments.ts frontend/src/__tests__/format-comments.test.ts
git commit -m "extract format-comments as pure functions with tests"
```

---

### Task 10: Keyboard shortcuts hook

**Files:**
- Create: `frontend/src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Create `useKeyboardShortcuts.ts`**

```ts
import { onMount, onCleanup } from 'solid-js';
import {
  appMode,
  files,
  activeFileIdx,
  setActiveFileIdx,
  wholeFileView,
  setWholeFileView,
  allCommits,
  reviewedFiles,
  toggleReviewed,
} from '../state';

interface Options {
  onRefresh: () => void;
  onToggleCommits: () => void;
  onJumpComment: (direction: 'next' | 'prev') => void;
}

export function useKeyboardShortcuts(options: Options) {
  function getAdjacentFileIdx(direction: 'next' | 'prev'): number | null {
    const items = Array.from(document.querySelectorAll<HTMLElement>('.file-item:not(.hidden)'));
    const currentPos = items.findIndex((el) => parseInt(el.dataset.idx!) === activeFileIdx());
    const targetPos = direction === 'next' ? currentPos + 1 : currentPos - 1;
    if (targetPos < 0 || targetPos >= items.length) return null;
    return parseInt(items[targetPos].dataset.idx!);
  }

  function handler(e: KeyboardEvent) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

    if (e.key === 'j' || e.key === 'ArrowDown') {
      const nextIdx = getAdjacentFileIdx('next');
      if (nextIdx !== null) {
        setActiveFileIdx(nextIdx);
        setWholeFileView(false);
        window.location.hash = 'file=' + encodeURIComponent(files()[nextIdx].path);
      }
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      const prevIdx = getAdjacentFileIdx('prev');
      if (prevIdx !== null) {
        setActiveFileIdx(prevIdx);
        setWholeFileView(false);
        window.location.hash = 'file=' + encodeURIComponent(files()[prevIdx].path);
      }
    } else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
      options.onRefresh();
    } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      (window as any).__focusFileSearch?.();
    } else if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
      if (allCommits().length > 0) options.onToggleCommits();
    } else if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
      const file = files()[activeFileIdx()];
      if (file) toggleReviewed(file.path);
    } else if (e.key === 'w' && !e.metaKey && !e.ctrlKey) {
      if (appMode() === 'diff' && files()[activeFileIdx()]) {
        setWholeFileView(!wholeFileView());
      }
    } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
      options.onJumpComment('next');
    } else if (e.key === 'p' && !e.metaKey && !e.ctrlKey) {
      options.onJumpComment('prev');
    }
  }

  onMount(() => document.addEventListener('keydown', handler));
  onCleanup(() => document.removeEventListener('keydown', handler));
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/
git commit -m "hooks: keyboard shortcuts for navigation and actions"
```

---

### Task 11: Persistence adapted for signals

**Files:**
- Modify: `frontend/src/persistence.ts`

- [ ] **Step 1: Rewrite `persistence.ts` to use signal-based state**

```ts
import { reviewedFiles, setReviewedFiles, sidebarView, setSidebarView } from './state';
import type { SidebarView } from './state';
import { fetchUserState, putUserReviewed, putUserSidebarView } from './api';

let lastReviewedSnapshot: Record<string, boolean> = {};
let lastSidebarView = '';

export async function loadState(): Promise<void> {
  try {
    const state = await fetchUserState();

    if (state.reviewedFiles) {
      for (const path of state.reviewedFiles) {
        setReviewedFiles(path, true);
      }
    }

    if (state.sidebarView && ['flat', 'grouped', 'phased'].includes(state.sidebarView)) {
      setSidebarView(state.sidebarView as SidebarView);
    }

    lastReviewedSnapshot = { ...reviewedFiles };
    lastSidebarView = sidebarView();
  } catch {
    /* server unavailable — start fresh */
  }
}

export function saveState(): void {
  // Sync reviewed files
  for (const path of Object.keys(reviewedFiles)) {
    if (reviewedFiles[path] && !lastReviewedSnapshot[path]) {
      putUserReviewed(path);
    }
  }
  for (const path of Object.keys(lastReviewedSnapshot)) {
    if (lastReviewedSnapshot[path] && !reviewedFiles[path]) {
      putUserReviewed(path);
    }
  }
  lastReviewedSnapshot = { ...reviewedFiles };

  if (sidebarView() !== lastSidebarView) {
    putUserSidebarView(sidebarView());
    lastSidebarView = sidebarView();
  }
}

export async function clearPersistedState(): Promise<void> {
  lastReviewedSnapshot = {};
  const { baseUrl } = await import('./api');
  await fetch(`${baseUrl()}/user-state/clear`, { method: 'POST' });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/persistence.ts
git commit -m "persistence: adapt to solid signals"
```

---

### Task 12: App.tsx — assemble everything + SSE

**Files:**
- Create: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Create `App.tsx`**

```tsx
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
  analysis,
  allCommits,
} from './state';
import { fetchItems, fetchItemData, fetchCommits, fetchAnalysis, submitReview as apiSubmitReview, addItem, removeItem, baseUrl } from './api';
import { fetchComments } from './comment-api';
import { parseDiff } from './diff';
import { formatAllComments } from './format-comments';
import { loadState, saveState, clearPersistedState } from './persistence';
import { escapeHtml } from './utils';
import { showToast } from './components/shared/Toast';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

import Header from './components/header/Header';
import TabBar from './components/tabs/TabBar';
import CommitPanel from './components/commits/CommitPanel';
import OverviewBanner from './components/overview/OverviewBanner';
import Sidebar from './components/sidebar/Sidebar';
import DiffView from './components/diff/DiffView';
import DocumentView from './components/document/DocumentView';
import Toast from './components/shared/Toast';

export default function App() {
  const [commitPanelOpen, setCommitPanelOpen] = createSignal(false);

  // --- Data loading ---

  async function loadItems() {
    try {
      const items = await fetchItems();
      setSessionItems(items);
    } catch { /* ignore */ }
  }

  async function loadComments() {
    try {
      const allComments = await fetchComments();
      setComments('list', allComments);
    } catch { /* ignore */ }
  }

  async function switchToItem(itemId: string) {
    setActiveItemId(itemId);
    const data = await fetchItemData(itemId);

    if (data.mode === 'diff') {
      setRepoMeta(data.meta || {});
      setAppMode('diff');
      setFiles(parseDiff(data.diff));
      if (files().length > 0 && activeFileIdx() >= files().length) setActiveFileIdx(0);
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
      } catch { /* ignore */ }
    } else if (data.mode === 'file') {
      setAppMode('file');
      setMdMeta(data);
      await loadComments();
    }
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
      const blockPreviews: Record<string, string> = {};
      document.querySelectorAll<HTMLElement>('.md-block[data-block]').forEach((el) => {
        const itemId = activeItemId();
        const blockIdx = el.dataset.block;
        if (blockIdx != null) {
          const key = `${itemId}-${blockIdx}`;
          blockPreviews[key] = el.textContent?.trim()?.slice(0, 80) || `Block ${blockIdx}`;
        }
      });

      const formatted = formatAllComments(comments.list, files(), sessionItems(), blockPreviews);
      const result = await apiSubmitReview(formatted, {});
      showToast(`Review round ${result.round} submitted!`, 3000);
      setComments('list', []);
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
    const shas = allCommits().filter((c) => selectedShas[c.sha]).map((c) => c.sha);
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
    es.addEventListener('comments_changed', () => {
      loadComments();
      showToast('New comments from Claude', 2000);
    });
    es.addEventListener('items_changed', () => {
      loadItems().then(() => showToast('Review items updated', 2000));
    });
    es.addEventListener('git_changed', () => {
      handleRefresh();
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

    await switchToItem('diff');

    // Set page title
    const meta = repoMeta();
    if (meta.repoName) {
      document.title = `${meta.repoName} — ${meta.branch || ''}`;
    }

    connectSSE();
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
        showCommitToggle={allCommits().length > 0}
      />
      <TabBar onSwitchItem={switchToItem} onCloseTab={handleCloseTab} />
      <CommitPanel visible={commitPanelOpen()} onApply={handleApplyCommits} />
      <Show when={appMode() === 'diff'}>
        <OverviewBanner />
      </Show>
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
          Click line to comment &middot; <kbd>Cmd+Enter</kbd> save &middot; <kbd>f</kbd> search (<code>!test *.py</code>) &middot; <kbd>w</kbd> whole file &middot; <kbd>e</kbd> reviewed &middot; <kbd>c</kbd> commits &middot; <kbd>n</kbd>/<kbd>p</kbd> next/prev comment
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
```

- [ ] **Step 2: Update `main.tsx`**

```tsx
import 'highlight.js/styles/github-dark.css';
import './style.css';
import { render } from 'solid-js/web';
import App from './App';

render(() => <App />, document.getElementById('root')!);
```

- [ ] **Step 3: Update `index.html`**

Make sure the body is just:
```html
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/main.tsx frontend/index.html
git commit -m "app: root component with SSE, data loading, keyboard shortcuts"
```

---

### Task 13: Remove old vanilla TS files

**Files:**
- Delete old files that have been replaced

- [ ] **Step 1: Remove replaced files**

Delete these files — their functionality now lives in Solid components:
- `frontend/src/ui.ts`
- `frontend/src/diff.ts` (keep `parseDiff` — extract it first)
- `frontend/src/comments.ts`
- `frontend/src/claude-comments.ts`
- `frontend/src/document.ts`
- `frontend/src/file-list.ts`
- `frontend/src/commit-picker.ts`

But first, extract `parseDiff` from `diff.ts` into its own file since components import it:

- [ ] **Step 2: Create `frontend/src/diff.ts` as a slim re-export**

The new `diff.ts` only exports `parseDiff` (a pure function). The component tree imports it from here.

```ts
// parseDiff — the only function from the old diff.ts that survives as-is.
// Moved here to preserve the import path for tests and App.tsx.

import type { DiffFile } from './state';

export function parseDiff(raw: string): DiffFile[] {
  const result: DiffFile[] = [];
  const lines = raw.split('\n');
  let current: DiffFile | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('diff --git')) {
      current = { path: '', additions: 0, deletions: 0, lines: [] };
      result.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('--- a/') || line.startsWith('--- /dev/null')) continue;
    if (line.startsWith('+++ b/')) {
      current.path = line.slice(6);
      continue;
    }
    if (line.startsWith('+++ /dev/null')) {
      if (i > 0 && lines[i - 1].startsWith('--- a/')) current.path = lines[i - 1].slice(6) + ' (deleted)';
      continue;
    }
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (match) {
        oldLine = parseInt(match[1]);
        newLine = parseInt(match[2]);
        current.lines.push({ type: 'hunk', content: line, oldLine: null, newLine: null });
      }
      continue;
    }
    if (/^(index |Binary |new file|deleted file|old mode|new mode|similarity|rename|copy )/.test(line)) continue;

    if (line.startsWith('+')) {
      current.additions++;
      current.lines.push({ type: 'add', content: line.slice(1), oldLine: null, newLine: newLine++ });
    } else if (line.startsWith('-')) {
      current.deletions++;
      current.lines.push({ type: 'del', content: line.slice(1), oldLine: oldLine++, newLine: null });
    } else if (line.startsWith(' ') || line === '') {
      current.lines.push({ type: 'context', content: line.slice(1) || '', oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return result.filter((f) => f.path);
}
```

- [ ] **Step 3: Delete old files**

```bash
rm frontend/src/ui.ts frontend/src/comments.ts frontend/src/claude-comments.ts frontend/src/document.ts frontend/src/file-list.ts frontend/src/commit-picker.ts
```

- [ ] **Step 4: Update test imports if needed**

The `diff.test.ts` imports `parseDiff` from `../diff` — this still works since `diff.ts` still exports it.

Run: `cd frontend && npm test`

Expected: All tests pass.

- [ ] **Step 5: Verify TypeScript compiles cleanly**

Run: `cd frontend && npx tsc --noEmit`

Expected: No errors. All imports resolve to the new component files.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src/
git commit -m "cleanup: remove old vanilla TS files, keep parseDiff as pure function"
```

---

### Task 14: CSS adjustments and build verification

**Files:**
- Modify: `frontend/src/style.css` (minor selector updates if needed)

- [ ] **Step 1: Build the production bundle**

Run: `cd frontend && npm run build`

Expected: Build succeeds. Check for any warnings about missing references.

- [ ] **Step 2: Start the dev server and test manually**

Run: `cd frontend && npm run dev`

Test the following manually:
1. Page loads and shows the diff view
2. File list appears in sidebar with correct badges
3. Clicking a file shows its diff
4. Clicking a line opens comment textarea
5. Saving a comment shows it inline
6. Pressing `w` switches to whole-file view
7. **Comments appear in whole-file view** (the bug fix)
8. **Clicking lines in whole-file view opens comment textarea** (the bug fix)
9. Tab bar shows items, clicking switches views
10. Document view works with block comments
11. Keyboard shortcuts work (j/k, n/p, e, f, c, r)
12. SSE events update the UI (git changes, new comments)

- [ ] **Step 3: Run all tests**

Run: `cd frontend && npm test`

Expected: All tests pass.

- [ ] **Step 4: Fix any CSS selector issues**

The existing CSS targets element IDs and classes that should remain the same in the Solid version. If any selectors break (e.g., because of component nesting changes), update the CSS.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A frontend/
git commit -m "css: adjust selectors for solid component structure"
```

---

### Task 15: Final cleanup and build validation

- [ ] **Step 1: Run lint**

Run: `cd frontend && npm run lint`

Fix any lint issues.

- [ ] **Step 2: Run format check**

Run: `cd frontend && npm run format`

- [ ] **Step 3: Run full test suite**

Run: `cd frontend && npm test`

- [ ] **Step 4: Production build**

Run: `cd frontend && npm run build`

- [ ] **Step 5: Commit**

```bash
git add -A frontend/
git commit -m "solid migration complete: all components, tests passing, build clean"
```
