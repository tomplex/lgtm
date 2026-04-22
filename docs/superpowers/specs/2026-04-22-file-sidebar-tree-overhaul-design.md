# File Sidebar — Tree View Overhaul

**Status:** Design approved, pending implementation plan.
**Date:** 2026-04-22
**Scope:** `frontend/src/components/sidebar/*`, `frontend/src/state.ts`, `frontend/src/App.tsx` keyboard handler; new `frontend/src/tree.ts`; tests under `frontend/src/__tests__/`.

## Goal

Replace the current three-view file sidebar (`Flat | Grouped | Phased`) with a single composable directory-tree view. Make the list easier to navigate (familiar tree semantics, keyboard drill-down) and easier to sort (compose sort + group-by chips rather than switching modes).

## Motivation

Today's sidebar has three separate view modes — each reshapes the list differently and two of them (`Grouped`, `Phased`) only exist when an AI analysis has been produced. The user has to pick a mode without being able to compose the underlying signals (directory structure, priority, phase, Claude-comments-first) against each other. A tree gives one mental model; sort/group become lenses applied to it.

## Non-goals

- No change to comment data model, review submission flow, diff rendering, or SSE wiring.
- No backend changes. This is frontend-only.
- No visual/CSS redesign beyond what the new structural components require.
- No new review heuristics or AI behaviors.

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
4. If `group === 'phase'`, replace the top level with three synthetic root nodes keyed by phase. Each root builds its own independent compact-folder sub-tree from the files in that phase.
5. Sort at each folder:
   - Folders first, then files (matches VS Code / Finder convention).
   - Claude-commented files float to the top of their containing folder, irrespective of sort mode.
   - Then active sort: `Path` = alphabetical; `Priority` = critical → important → normal → trivial, with `Path` as tie-break.
   - If analysis is absent, `Priority` degrades to pure alphabetical (priority is null).

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

1. **Folder-path matching.** A query term is matched against each file's full path (existing) *and* each compact-folder's full path. A folder is considered a match if its path matches; its files inherit visibility. This lets `sidebar/` filter the tree to just that subtree.
2. **Auto-expand on match.** When `filterQuery()` is non-empty, folders with visible descendants auto-expand regardless of their persisted collapse state. Persisted state is restored the moment the filter clears.

## Folder affordances

- **Chevron** (▾ / ▸) — click toggles collapse.
- **Progress indicator** — right-aligned `reviewed/total` count over the folder's files (recursive). When `reviewed === total && total > 0`, the count renders in the "done" muted/green style and the folder auto-collapses (one-shot: if the user reopens it, it stays open).
- **Dismiss `×`** — hides the whole subtree for the session. Same undismiss-all banner surfaces when either files or folders are dismissed.
- **Compact-folder rows** behave as a single node: one chevron, one collapse state, one count spanning the whole chain's files.

## Keyboard

New / changed:

- `j` / `k` — next / previous visible row (files and folders alike, in rendered order).
- `h` — on folder: collapse. On file: jump to parent folder row.
- `l` — on folder + collapsed: expand. On folder + expanded: move to first child. On file: no-op.
- `[` / `]` — jump to previous / next folder row ("paragraph" jump).
- `o` — toggle collapse of the folder containing the current file.

Unchanged: `e` toggles reviewed on the active file; `f` focuses filter; `Enter`/`Esc` in filter.

**Selection semantics:** landing on a file row via `j`/`k` loads the diff (current behavior). Landing on a folder row does not load anything — focus just sits there.

## State

### Added

- `sortMode: Signal<'path' | 'priority'>` — default `'path'`. Persisted per-project.
- `groupMode: Signal<'none' | 'phase'>` — default `'none'`. Persisted per-project. Promoted to `'phase'` once on first load if analysis is present and `groupModeUserTouched` is false.
- `groupModeUserTouched: Signal<boolean>` — set true the first time the user clicks a `Group by` chip. Persisted per-project.
- `collapsedFolders: Store<Record<string, boolean>>` — keyed by compact-folder path. Persisted per-project.
- `dismissedFolders: Signal<Set<string>>` — session-only, parallel to existing `dismissedFiles`.
- `activeRowId: Signal<string | null>` — replaces `activeFileIdx` as the selection anchor.
- `activeFile: () => DiffFile | null` — derived memo returning the `DiffFile` when `activeRowId` is a file row, else `null`. All existing `files()[activeFileIdx()]` consumers route through this.

### Removed

- `sidebarView: Signal<'flat' | 'grouped' | 'phased'>`, `setSidebarView`, the `SidebarView` type.
- `activeFileIdx` — replaced by `activeRowId` with the `activeFile` shim.

### Persistence

`localStorage` key `lgtm.sidebar.<projectSlug>` stores one blob:

```json
{
  "sortMode": "path",
  "groupMode": "phase",
  "groupModeUserTouched": true,
  "collapsedFolders": { "frontend/src/components/sidebar/": true }
}
```

Loaded when the active project changes; written on any of the above signals changing. `dismissedFiles` and `dismissedFolders` stay in-memory only.

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

No server changes. No new dependencies.

## Call-site updates

- `App.tsx` keyboard handler — swap `activeFileIdx` nav for `activeRowId` nav; add `h`/`l`/`[`/`]`/`o`.
- `App.tsx` hash sync (`#file=<path>`) — wire through `activeFile()` shim; folders never appear in the hash.
- Any other reader of `activeFileIdx` (comment routing, `setWholeFileView`, etc.) — route through `activeFile()`.
- `frontend/src/analysis.ts` — `sortFilesByPriority`, `groupFiles`, `phaseFiles` stay; they're still useful as primitives for `buildTree`.

## Testing

New test files:

- `frontend/src/__tests__/tree.test.ts` — pure tree logic:
  - Compact-folder merging across simple chains, branching stops merge, folders with own files stop merge.
  - Phase grouping produces three independent sub-trees with correct membership.
  - Sort modes: `Path` alphabetical, `Priority` ordering with tie-break, analysis-absent degradation.
  - Claude-comments-first float within a folder.
  - Filter: file-path match, folder-path match, empty-folder hiding, negation, glob, auto-expand.
- `frontend/src/__tests__/sidebar-keyboard.test.ts` — keyboard semantics:
  - `j`/`k` across mixed folder/file rows.
  - `h`/`l` folder behavior + file→parent.
  - `[`/`]` folder jump.
  - `o` toggle on file's containing folder.

Existing tests: update or delete anything that references `sidebarView`, `FlatFileList`, `GroupedFileList`, `PhasedFileList`.

## Migration

Replace, don't gate. Small codebase, single primary user, all pre-existing behaviors preserved either directly (comments-float, dismiss, reviewed checks, priority classes) or re-expressed through the new chips (phased view → `Group by: Phase`; grouped view drops; flat view → tree with `Group by: None`). Users with stale `sidebarView` in localStorage get a fresh default on first load — the key is simply not read.

**Behavior drop:** the current `Grouped` view — which uses AI-classified thematic group names from `analysis.groups` — has no direct analog in the tree. That taxonomy is orthogonal to directory structure and doesn't map cleanly onto sort/group chips. Accepted loss: analysis-driven thematic grouping goes away; phase-driven grouping remains as the primary AI lens.

## Open questions

None outstanding. All clarifying decisions captured above.
