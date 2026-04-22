# File Sidebar — Tree View Overhaul

**Status:** Design approved, pending implementation plan.
**Date:** 2026-04-22
**Scope:** `frontend/src/components/sidebar/*`, `frontend/src/state.ts`, `frontend/src/persistence.ts`, `frontend/src/hooks/useKeyboardShortcuts.ts`, `frontend/src/ProjectView.tsx`, `frontend/src/api.ts`, consumers of `activeFileIdx` in `frontend/src/components/diff/*`; new `frontend/src/tree.ts`; tests under `frontend/src/__tests__/` and `server/__tests__/`. Server: extend `/user-state` schema in `server/app.ts` and the session store.

## Goal

Replace the current three-view file sidebar (`Flat | Grouped | Phased`) with a single composable directory-tree view. Make the list easier to navigate (familiar tree semantics, keyboard drill-down) and easier to sort (compose sort + group-by chips rather than switching modes).

## Motivation

Today's sidebar has three separate view modes — each reshapes the list differently and two of them (`Grouped`, `Phased`) only exist when an AI analysis has been produced. The user has to pick a mode without being able to compose the underlying signals (directory structure, priority, phase, Claude-comments-first) against each other. A tree gives one mental model; sort/group become lenses applied to it.

## Non-goals

- No change to comment data model, review submission flow, diff rendering, or SSE wiring.
- No visual/CSS redesign beyond what the new structural components require.
- No new review heuristics or AI behaviors.

Note: backend changes *are* required — the existing `/user-state` API persists `sidebarView` and `reviewedFiles`; `sidebarView` is being replaced by `sortMode`, `groupMode`, `groupModeUserTouched`, and `collapsedFolders`. See [Persistence](#persistence).

## UX shape

Sidebar becomes, top-to-bottom:

1. **Filter input.** Same placeholder (`Filter files... (f)`), same keyboard affordance. Filtering semantics extended — see [Filter](#filter).
2. **Sort/group chip row.** Rendered only when `analysis()` is present.
   - `Sort:` — `Path` (default) | `Priority`.
   - `Group by:` — `None` | `Phase`.
3. **Tree.** Compact-folder tree, optionally grouped into phase roots.

### Defaults on first load
- No analysis → `Sort: Path`, `Group by: None`. Plain tree.
- Analysis present → `Sort: Path`, `Group by: Phase`. Three synthetic roots: `● Review carefully`, `◐ Skim`, `○ Rubber stamp`, each containing a compact-folder tree of the files in that phase.

Persisted `sortMode` / `groupMode` override defaults when present. A `groupModeUserTouched` flag prevents the "promote to phase when analysis arrives" logic from fighting a user who has explicitly chosen `None`.

## Tree model

### Build

Pure function `buildTree(files, analysis, { sort, group }) → TreeNode[]`:

1. For each changed file path, split on `/`.
2. Insert into a trie of directories → files.
3. Walk the trie; collapse single-child directory chains: any directory with exactly one child directory and no files of its own merges with that child. Merging stops when the chain branches or when the directory contains files. Result: rows like `frontend/src/`, `components/sidebar/`.
4. If `group === 'phase'`, replace the top level with three synthetic root nodes keyed by phase. Each root builds its own independent compact-folder sub-tree from the files in that phase. Sort rules in step 5 apply within each phase's sub-tree independently; the three phase roots themselves are fixed in order (`review` → `skim` → `rubber-stamp`).
5. Sort at each folder:
   - Folders first, then files (matches VS Code / Finder convention).
   - Claude-commented files float to the top of their containing folder, irrespective of sort mode.
   - Then active sort: `Path` = alphabetical; `Priority` = `critical` → `important` → `normal` → `low`, with `Path` as tie-break. (Priority enum matches `FileAnalysis.priority` in `state.ts` — `low`, not `trivial`.)
   - Files without analysis entries (or when `analysis()` is null) get effective priority `low` and fall through to the `Path` tie-break. Existing `analysis.ts::sortFilesByPriority` uses *original array order* as tie-break; it needs to be updated to match the spec's `Path` tie-break, or `buildTree` should inline its own comparator.

### Node shape

```ts
type TreeNode = FolderNode | FileNode;

interface FolderNode {
  kind: 'folder';
  id: string;             // stable — compact-folder path, phase-prefixed when grouped
  name: string;           // display name (can contain slashes for compact rows)
  fullPath: string;       // canonical path of deepest segment in the compact chain
  depth: number;
  children: TreeNode[];
}

interface FileNode {
  kind: 'file';
  id: string;             // stable — file path (phase-prefixed when grouped)
  file: DiffFile;
  depth: number;
}
```

IDs are phase-prefixed when `group === 'phase'` so the same file can appear under only one phase at a time but its stable ID survives expand/collapse re-renders.

### Flatten

Pure function `flattenVisible(tree, { collapsedFolders, dismissedFolders, dismissedFiles, filterQuery }) → TreeNode[]`:

- Recursive walk produces the linear list of rows to render.
- A folder is skipped entirely if it is dismissed.
- A file is skipped if it is dismissed or does not match the active filter.
- A folder is skipped if, after recursion, it has no visible children (prevents "empty folder" rows under filter).
- Collapse state is honored unless the filter is active — active filter forces auto-expand of any folder with a visible descendant.

### Rebuild triggers

A single `createMemo` over `files()`, `analysis()`, `sortMode()`, `groupMode()` produces the tree. A second memo over the tree + `collapsedFolders()`, `dismissedFolders()`, `dismissedFiles()`, `filterQuery()` produces the visible rows. Solid handles reactivity.

## Filter

The existing filter logic (space-separated terms, glob `*`, `!` negation, AND across terms) is preserved. Two extensions:

1. **Folder-path matching.** A query term is matched against each file's full path (existing) *and* each compact-folder's full path. When a folder matches the filter, *every* file inside that folder (recursively) is treated as visible, even if the file paths themselves don't independently match. This lets `sidebar/` act as a subtree filter.
2. **Auto-expand on match.** When `filterQuery()` is non-empty, folders with visible descendants auto-expand regardless of their persisted collapse state. Persisted state is restored the moment the filter clears.
3. **Filter overrides dismiss.** When a filter is active, dismissed folders and files become visible again if they match. Consistent with (2) — the filter is the user explicitly asking to see matching things. Dismiss state is preserved (not cleared); it resumes effect when the filter clears.

## Folder affordances

- **Chevron** (▾ / ▸) — click toggles collapse.
- **Progress indicator** — right-aligned `reviewed/total` count over the folder's files (recursive). When `reviewed === total && total > 0`, the count renders in the "done" muted/green style and the folder auto-collapses (one-shot: if the user reopens it, it stays open).
- **Dismiss `×`** — hides the whole subtree for the session. Same undismiss-all banner surfaces when either files or folders are dismissed.
- **Compact-folder rows** behave as a single node: one chevron, one collapse state, one count spanning the whole chain's files. `h` on a file inside a compact chain jumps to that single folder row.

**Empty state.** When `files()` is empty, the chip row is hidden (no analysis-driven controls matter) and the tree area renders nothing — the existing `<div class="empty-state">No changes to review</div>` in `ProjectView.tsx` continues to fill the diff pane. When `files()` is non-empty but every file is filtered out, the tree area renders a small "No matches" row (new).

**Accessibility.** The tree container gets `role="tree"`. Folder rows get `role="treeitem"` with `aria-expanded`, `aria-level`, and `aria-selected`. File rows get `role="treeitem"` with `aria-level` and `aria-selected`. The reviewed/total counter on a folder gets an `aria-label` (e.g. `"2 of 4 files reviewed"`) so screen readers announce progress. Keyboard focus follows `activeRowId`.

## Keyboard

New / changed:

- `j` / `k` — next / previous visible row (files and folders alike, in rendered order).
- `h` — on folder: collapse. On file: jump to parent folder row.
- `l` — on folder + collapsed: expand. On folder + expanded: move to first child. On file: no-op.
- `[` / `]` — jump to previous / next folder row ("paragraph" jump).
- `o` — toggle collapse of the folder containing the current file.

Unchanged: `e` toggles reviewed on the active file; `f` focuses filter; `Enter`/`Esc` in filter.

**Selection semantics:** landing on a file row via `j`/`k` loads the diff *and* rewrites the `#file=` hash (current `activeFileIdx` behavior, preserved through the `activeFile()` shim). Landing on a folder row is ephemeral: no hash update, no `wholeFileView` reset, no per-tab `fileIdx` save. Folder focus exists only to anchor `h`/`l`/`o`/chevron actions; it doesn't become the "current file" from the diff pane's perspective.

## State

### Added

- `sortMode: Signal<'path' | 'priority'>` — default `'path'`. Persisted per-project.
- `groupMode: Signal<'none' | 'phase'>` — default `'none'`. Persisted per-project. Promoted to `'phase'` once on first load if analysis is present and `groupModeUserTouched` is false.
- `groupModeUserTouched: Signal<boolean>` — set true the first time the user clicks a `Group by` chip. Persisted per-project.
- `collapsedFolders: Store<Record<string, boolean>>` — keyed by compact-folder path. Persisted per-project.
- `dismissedFolders: Signal<Set<string>>` — session-only, parallel to existing `dismissedFiles`.
- `activeRowId: Signal<string | null>` — replaces `activeFileIdx` as the selection anchor. The value is the `id` of a `TreeNode` (phase-prefixed file or folder path when grouped, plain path otherwise), not a file path directly.
- `activeFile: () => DiffFile | null` — **replaces** the existing `activeFile` memo at `state.ts:189` (which today is `createMemo(() => files()[activeFileIdx()])`). The new memo looks up `activeRowId` in the current visible-rows list and returns the `DiffFile` when it resolves to a `FileNode`, else `null`. All direct readers of `files()[activeFileIdx()]` — today in `DiffView.tsx`, `WholeFileView.tsx`, `ProjectView.tsx`, `useKeyboardShortcuts.ts`, `FileList.tsx` — switch to calling `activeFile()` instead.

**`activeRowId` stability across tree rebuilds.** When `files()` / `analysis()` / `sortMode` / `groupMode` change and `activeRowId` no longer resolves to a visible row, snap to the first visible file row (or `null` if none). Rationale: the row-id format encodes phase prefix, so simply flipping `groupMode` invalidates every id; we can't preserve the selection across that boundary without an explicit recovery rule.

**Hash-nav into a hidden row.** When the URL `#file=<path>` changes, or on initial load, resolve the file to its current row id. If ancestor folders are collapsed, force-expand them (writing to `collapsedFolders`). If an ancestor folder is dismissed this session, un-dismiss it. Hash-nav wins over persisted collapse and session dismiss — the user asked to see that file.

### Removed

- `sidebarView: Signal<'flat' | 'grouped' | 'phased'>`, `setSidebarView`, the `SidebarView` type. Referenced in `state.ts`, `api.ts`, `persistence.ts`, `ViewToggle.tsx`, `FileList.tsx` — all must be updated or deleted.
- `activeFileIdx` — replaced by `activeRowId` with the `activeFile` shim.

### Persistence

Persistence follows the **existing server-side `/user-state` pattern** (see `frontend/src/persistence.ts` and `server/app.ts:429-459`), not localStorage. The current API round-trips `reviewedFiles` and `sidebarView`; this spec replaces the `sidebarView` field with four new fields:

```ts
// /project/:slug/user-state response shape (extended)
{
  reviewedFiles: string[],                          // unchanged
  sortMode: 'path' | 'priority',                    // new
  groupMode: 'none' | 'phase',                      // new
  groupModeUserTouched: boolean,                    // new
  collapsedFolders: Record<string, boolean>,        // new
  // sidebarView: removed
}
```

**Server changes required:**
- Extend the session-store schema used by `/user-state` (likely `server/store.ts` / `server/session.ts` — verify during implementation).
- Replace `PUT /user-state/sidebar-view` with endpoints for the new fields. Simplest path: one `PUT /user-state/sidebar-prefs` endpoint that accepts a partial of the four new fields. `reviewedFiles` keeps its own dedicated endpoint unchanged.
- Update `server/__tests__/routes.test.ts` — remove the `sidebar-view` cases, add `sidebar-prefs` cases.
- `frontend/src/persistence.ts` — rewrite `loadState`/`saveState` to load and diff the new fields. `lastSidebarView` becomes per-field diff tracking.
- `frontend/src/api.ts` — replace `putUserSidebarView` with `putUserSidebarPrefs`.

**`groupModeUserTouched` promotion scope.** Per-project. The flag is part of the server-persisted state blob keyed by project slug. Opening a different project reads that project's own flag; the "auto-promote to phase on first load when analysis arrives" rule fires per-project.

**`collapsedFolders` semantics.**
- Keyed by compact-folder path (the fully-merged chain path).
- Best-effort across rebuilds: when the file set changes and a chain's shape shifts (e.g. a sibling file appears mid-chain and splits it), stale keys linger but do nothing — they just reference paths that don't exist in the current tree. No GC pass; acceptable drift.
- Written on any user-initiated collapse/expand. Not written for hash-nav force-expand (transient).

**Auto-enabled analysis views outliving analysis.**
- If `sortMode === 'priority'` but `analysis()` is null: effective sort degrades to pure `Path`. Stored signal value is untouched; when analysis returns, priority sort resumes.
- If `groupMode === 'phase'` but `analysis()` is null: effective grouping degrades to `'none'`. Stored signal value is untouched; when analysis returns, phase grouping resumes.
- The chip row is hidden when analysis is absent, so the user cannot see or adjust these values in that state — but their persisted choice survives.

`dismissedFiles` and `dismissedFolders` stay in-memory only (session-scoped).

## Components

`frontend/src/components/sidebar/`:

- `Sidebar.tsx` — shell. Renders `FileSearch`, `SortGroupControls`, `FileTree`. Holds the `filterQuery` signal.
- `SortGroupControls.tsx` *(new)* — chip row, gated on `analysis()`. Two button groups wired to `sortMode`/`groupMode`. Clicking a `Group by` chip sets `groupModeUserTouched = true`.
- `FileTree.tsx` *(new)* — owns the `tree` memo and `visibleRows` memo. Renders `TreeFolder` / `TreeFile` for each visible row. Hosts the keyboard handler for tree shortcuts.
- `TreeFolder.tsx` *(new)* — folder row: chevron, name (possibly with slashes for compact chains), progress count, dismiss `×`. Indents by `depth`.
- `TreeFile.tsx` *(new)* — file row: review check, filename, Claude/user comment badges, `+N -N` stats, dismiss `×`, priority class. Indents by `depth`. Essentially today's `FileItem` stripped of `showDir`/`showSummary`/`grouped`/`phased` modifiers.

Deleted:
- `ViewToggle.tsx`.
- `FileList.tsx` (and its internal `FlatFileList`, `GroupedFileList`, `PhasedFileList`, `FileItem`).

Lifted:
- `dismissedFiles` currently lives inside `FileList.tsx`; it moves into `state.ts` to sit next to `dismissedFolders`.

## Utilities

`frontend/src/tree.ts` *(new)*:

- `buildTree(files, analysis, opts) → TreeNode[]`.
- `flattenVisible(tree, opts) → TreeNode[]`.
- `matchesFilter(path, query)` — extended from existing `fileMatchesFilter` to handle folder-path queries.

No new dependencies. (`tree.ts` itself is pure frontend; server-side changes are scoped to the `/user-state` schema — see [Persistence](#persistence).)

## Call-site updates

`App.tsx` is an 8-line router and is **not** touched. The logic lives further down:

- `frontend/src/hooks/useKeyboardShortcuts.ts` — the real keyboard handler. Swap `activeFileIdx` nav for `activeRowId` nav; add `h`/`l`/`[`/`]`/`o`; preserve `e`, `f`, existing j/k hash-write behavior (but only when the active row is a file).
- `frontend/src/ProjectView.tsx` — hash sync (`hashchange` listener, initial-load `#file=` resolution around lines 117 / 220 / 332-341) routes through the `activeFile()` shim; per-tab scroll state cache at lines 63-82 currently keys on `activeFileIdx` — retarget to the active row's file path (or drop if no active file).
- `frontend/src/components/diff/DiffView.tsx`, `frontend/src/components/diff/WholeFileView.tsx` — direct `files()[activeFileIdx()]` readers; switch to `activeFile()`.
- `frontend/src/persistence.ts` — rewritten to load/save `sortMode`, `groupMode`, `groupModeUserTouched`, `collapsedFolders` against the extended `/user-state` API. `lastSidebarView` becomes four per-field diff trackers.
- `frontend/src/api.ts` — replace `putUserSidebarView` with `putUserSidebarPrefs`; drop the `SidebarView`-related typing.
- `frontend/src/analysis.ts` — `sortFilesByPriority`, `groupFiles`, `phaseFiles` stay as primitives. `sortFilesByPriority`'s tie-break needs a path-based update to match the spec, or `buildTree` inlines its own comparator and the primitive goes unused by the new code.
- `server/app.ts` — replace `PUT /user-state/sidebar-view` route with `PUT /user-state/sidebar-prefs`; extend `GET /user-state` response shape.
- Server session-store schema — add fields; verify the exact file during implementation (likely `server/store.ts` or `server/session.ts`).

## Testing

New test files:

- `frontend/src/__tests__/tree.test.ts` — pure tree logic:
  - Compact-folder merging across simple chains, branching stops merge, folders with own files stop merge.
  - Phase grouping produces three independent sub-trees with correct membership.
  - Sort modes: `Path` alphabetical, `Priority` ordering with `Path` tie-break, analysis-absent degradation.
  - Claude-comments-first float within a folder.
  - Filter: file-path match, folder-path match, empty-folder hiding, negation, glob, auto-expand, filter-overrides-dismiss.
  - `activeRowId` survival across rebuild: snap-to-first-visible rule when the prior row disappears.
- `frontend/src/__tests__/sidebar-keyboard.test.ts` — keyboard semantics:
  - `j`/`k` across mixed folder/file rows.
  - `h`/`l` folder behavior + file→parent.
  - `[`/`]` folder jump.
  - `o` toggle on file's containing folder.
  - Folder row is ephemeral (no hash write, no `wholeFileView` reset).
- `frontend/src/__tests__/persistence.test.ts` *(if absent; extend if present)* — round-trip of `sortMode`/`groupMode`/`groupModeUserTouched`/`collapsedFolders`; graceful handling of absent server state; analysis-disappears-mid-session preserving signal values.

Server tests:

- `server/__tests__/routes.test.ts` — remove `PUT /user-state/sidebar-view` cases; add `PUT /user-state/sidebar-prefs` cases (partial updates, validation of enum values, rejection of unknown fields).
- Update `GET /user-state` test for the new response shape.

Existing tests: update or delete anything that references `sidebarView`, `FlatFileList`, `GroupedFileList`, `PhasedFileList`.

## Migration

Replace, don't gate. Small codebase, single primary user, all pre-existing behaviors preserved either directly (comments-float, dismiss, reviewed checks, priority classes) or re-expressed through the new chips (phased view → `Group by: Phase`; grouped view drops; flat view → tree with `Group by: None`). Servers with stale `sidebarView` in the user-state blob get their field ignored on first load — the read path will skip unknown fields and the write path will never set it again.

**Behavior drops / changes:**
- The current `Grouped` view — which uses AI-classified thematic group names from `analysis.groups` — has no direct analog in the tree. That taxonomy is orthogonal to directory structure. Accepted loss: analysis-driven thematic grouping goes away; phase-driven grouping remains as the primary AI lens.
- Claude-commented files currently float to the *global top* of the flat list. In the tree, they float to the top of their *containing folder* instead. This is a real behavioral change, not a carry-over; it's consistent with the one-tree mental model but callers who rely on "look at the top of the list for Claude's flagged files" see the signal distributed across folders. The chip badges still make them findable.
- The dismiss banner copy (`N hidden files — show all`) needs updating for the mixed case when both files and folders are dismissed — e.g. `3 hidden items — show all`.
- The chip row appears/disappears when analysis arrives mid-session (SSE), causing a one-time layout shift. Acceptable; not reserving space.

## Open questions

None outstanding. All clarifying decisions captured above.
