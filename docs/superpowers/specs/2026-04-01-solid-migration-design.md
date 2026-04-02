# Frontend Migration: Vanilla TS → SolidJS

## Background

The LGTM frontend is ~2,700 lines of vanilla TypeScript across 13 source files. It uses imperative DOM manipulation, manual event wiring and a hand-rolled mutable state system (`export let` + setter functions). This has worked fine up to now, but the pattern is starting to fight back - features like whole-file commenting don't work because the whole-file view renders lines without the `id` and `data-line-id` attributes that the click handler needs. Every new interactive feature requires re-wiring the same DOM plumbing.

The app is a code review tool for Claude Code sessions. It renders diffs, supports inline commenting (both user and Claude-generated), handles document/markdown review, and communicates with a local server via REST + SSE.

## Problem

The core issue isn't that the app is broken - it's that adding features requires duplicating DOM wiring logic across views. The whole-file comment bug is a perfect example: diff view and whole-file view render lines differently, so comments only work in one. A component model eliminates this class of bug entirely.

Secondary issues:
- State changes require manual re-render calls (`renderDiff()`, `renderFileList()`) scattered across the codebase
- No reactivity - changing a signal doesn't update the UI unless you explicitly call the right render functions in the right order
- HTML is built via template strings, which means no type checking on the markup and easy-to-miss attribute omissions

## Why Solid

The current architecture is already closer to Solid than to React/Preact. The app has mutable state with explicit setters, does surgical DOM updates and wires up event handlers imperatively. Solid formalizes this pattern and makes it reactive, while React/Preact would require adopting a re-render-everything-then-diff model that's actually less precise than what we have.

Key advantages:
- Fine-grained reactivity: components run once (setup), signals drive direct DOM updates. No virtual DOM diffing.
- `createSignal` is essentially what `state.ts` already does manually
- Performance is free - no wasted re-renders for a UI that renders thousands of diff lines
- ~7KB bundle

The tradeoff is less LLM training data than React and a smaller ecosystem, but the API surface is small enough that this hasn't been a practical problem.

## Architecture

### State layer (`state.ts`)

All state becomes Solid signals and stores.

**Signals** for values replaced wholesale:
- `activeFileIdx`, `activeItemId`, `appMode`, `wholeFileView`, `sidebarView` - scalar signals
- `files`, `claudeComments`, `sessionItems`, `allCommits`, `repoMeta`, `mdMeta`, `analysis` - data fetched from server, replaced on each fetch

**Stores** for user-editable collections with partial updates:
- `comments` → `createStore<Record<string, string>>` - partial updates via `setComments(key, value)`
- `reviewedFiles` → `createStore<Record<string, boolean>>`
- `resolvedComments` → `createStore<Record<string, boolean>>`

**Derived state** with `createMemo`:
- File comment counts (sidebar badges) - derived from `comments` store
- Claude comment counts per tab - derived from `claudeComments` signal
- Filtered file list - derived from `files` + search query + `sidebarView` + `analysis`
- Grouped/phased file ordering - derived from `files` + `analysis`

**Effects:**
- `createEffect` watching `activeItemId` → fetch item data, update signals
- `createEffect` watching `activeFileIdx` → update URL hash
- Persistence: `createEffect` watching comments + reviewed + resolved → debounced save

### Component tree

```
App
├── Header (repo name, branch, PR link, action buttons)
├── TabBar (session items, badges, add/close)
├── CommitPanel (collapsible)
├── OverviewBanner (collapsible, analysis data)
├── MainLayout
│   ├── Sidebar
│   │   ├── ViewToggle (flat/grouped/phased)
│   │   ├── FileSearch
│   │   └── FileList (file items with comment counts, reviewed state)
│   ├── ResizeHandle
│   └── ContentArea
│       ├── DiffView
│       │   ├── DiffLine (line numbers, content, click-to-comment)
│       │   ├── CommentRow (inline user comment with edit/save/delete)
│       │   └── ClaudeCommentRow (reply/resolve)
│       ├── WholeFileView (reuses DiffLine component)
│       └── DocumentView (markdown blocks with comments)
└── Toast
```

⭐ The whole-file comment bug disappears by design: `DiffLine` is a component that always supports commenting regardless of whether it appears in diff or whole-file context.

### Data flow

State changes are reactive. Today's pattern of `saveComment → saveState() → renderDiff() → renderFileList()` becomes: `setComments(key, text)`. The sidebar badge, comment row and file list count all update automatically because they read from that store.

SSE stays imperative - the EventSource connection just calls signal setters when events arrive.

Keyboard shortcuts either stay as a top-level `document.addEventListener` or move into a `useKeyboardShortcuts()` hook that reads signals for context (active file, app mode, etc).

## Build setup

- Add `solid-js` and `vite-plugin-solid`
- Update `tsconfig.json`: `"jsx": "preserve"`, `"jsxImportSource": "solid-js"`
- Update `vite.config.ts` to use the Solid plugin
- Vitest stays. Pure function tests (`parseDiff`, format helpers) carry over unchanged.

## Migration strategy

Full rewrite, not incremental. At ~2,700 lines the app is small enough that adapter layers between imperative DOM code and Solid components would cost more than they save.

**Carries over largely unchanged:**
- `parseDiff()` - pure function, moves to a util
- `api.ts` - fetch functions are framework-agnostic
- `persistence.ts` - storage logic stays, wiring changes to effects
- `utils.ts` - `escapeHtml`, `detectLang`, `highlightLine`, `renderMd` all pure
- CSS - mostly reusable with selector adjustments for new component structure
- Existing tests for pure functions

**Gets rewritten as components:**
- `state.ts` → signals and stores
- `ui.ts`, `diff.ts`, `file-list.ts`, `comments.ts`, `claude-comments.ts`, `document.ts`, `commit-picker.ts` → Solid components
- `main.ts` → slim entry: `render(() => <App />, root)`, SSE setup
- `index.html` → simplifies to a `<div id="root">`

**Note:** A significant comment unification refactor recently landed. The implementation plan should read the current state of `comments.ts`, `claude-comments.ts` and `state.ts` rather than assuming the structure described here - the signal/store mapping (especially `comments`, `resolvedComments` and any new unified comment types) will need to reflect whatever shape the comment system is in at implementation time.

## What this doesn't change

- Server API contract - no backend changes needed
- Feature set - this is a rewrite for maintainability, not a feature addition
- CSS approach - still plain CSS, no CSS-in-JS

## Decisions

- **Component file organization:** One component per file, grouped by directory. Something like `src/components/diff/DiffLine.tsx`, `src/components/diff/CommentRow.tsx`, `src/components/sidebar/FileList.tsx`, etc. Directories map to natural UI boundaries.
- **Testing strategy:** Pure function tests only for now. No `solid-testing-library`. The existing vitest tests for `parseDiff`, format helpers, etc. carry over. Component testing can be added later if needed.
