# Project Browser

## Overview

Let the user browse between registered projects from one window. Today, each project lives at `/project/<slug>/` and the only way to find another project is to know its URL. This spec adds two entry points into a shared project registry UI:

- **Landing page at `/`** — rendered when the URL has no slug. Lists every registered project as a card.
- **Cmd-K palette** — opens from any project view. The header's repo name becomes a button that triggers the same palette.

Both consume the same enhanced `GET /projects` endpoint. Navigating between projects is a full page reload — the frontend and SSE are already slug-scoped, so this avoids dealing with tear-down/setup.

## Server changes

### Enrich `GET /projects`

Currently returns `{ slug, repoPath, description }` per project. Extend each entry with live session state:

```ts
{
  slug: string;
  repoPath: string;
  description: string;
  repoName: string;                          // basename(repoPath) for display
  branch: string | null;                     // null when repo missing
  baseBranch: string;
  pr: { number: number; url: string } | null;
  claudeCommentCount: number;                // top-level, not-dismissed, author=claude
  userCommentCount: number;                  // top-level, not-dismissed, author=user
}
```

- `branch`, `baseBranch`, and `pr` come from `getRepoMeta(session.repoPath, session.baseBranch)` in `git-ops.ts`.
- Comment counts come from `session.listComments(...)`, then a JS post-filter on `c.parentId == null` (the store's `CommentFilter.parentId === undefined` means "don't filter"). Count semantics match the in-project header (`userCommentCount` in `state.ts`): include `active` and `resolved`, exclude `dismissed`. Partition by `author` for the two counts.
- Each project is wrapped in try/catch. If the repo directory no longer exists or git fails, return `branch: null, pr: null` rather than failing the whole endpoint. Comment counts are still computed (they don't touch git). The UI uses `branch: null` as the "repo missing" signal.

### Serving `/`

`express.static(distDir)` already serves `dist/index.html` at `/` by default. No new route is needed for the landing page URL itself — the SolidJS app boots and decides which view to render based on the pathname. Do not add a redundant `app.get('/', ...)`. The existing `/project/{*path}` fallback continues to handle deep links into the project view.

## Frontend changes

### Routing

Today's `App.tsx` runs `useKeyboardShortcuts(...)` at component body and schedules `onMount(...)` that fires `loadState`, `fetchItems`, `fetchAnalysis`, `switchToItem`, and `connectSSE()`. All of these hit slug-scoped endpoints (`/items`, `/events`, …) which return 404 on `/`, and `connectSSE` reconnects every 5s on error — so we must not run the project view's hooks or mount when no slug is present.

Refactor: extract the current `App` body into a new `ProjectView` component (moves the project-scoped hooks, `onMount`, signals, and JSX). `App.tsx` becomes a thin router:

```ts
export default function App() {
  if (!getProjectSlug()) return <LandingPage />;
  return <ProjectView />;
}
```

Mark `getProjectSlug()` exported in `api.ts` (it is currently module-private).

`api.ts` gets two new root-level helpers. They do **not** use `baseUrl()` (they hit `/projects`, not `/project/:slug/...`) but they **do** go through `checkedJson` for consistent error surfacing:

```ts
export async function fetchRegisteredProjects(): Promise<ProjectSummary[]>;
export async function deregisterProject(slug: string): Promise<void>;
```

### State

New signal in `state.ts`:

```ts
export const [paletteOpen, setPaletteOpen] = createSignal(false);
```

### `LandingPage` component

New file at `frontend/src/components/landing/LandingPage.tsx`. A grid of project cards.

Each card shows:

- Repo name (large, bold)
- `branch → baseBranch` line, with a PR badge if `pr` is present
- Count line: `N drafted · M from Claude`. Counts are colored when non-zero, muted when zero.
- Description below, if set
- × button visible on hover → inline "Remove? Yes / No" confirm → calls `deregisterProject(slug)` and refetches the list

Clicking the card body navigates via `window.location.href = /project/<slug>/`.

Empty state (no projects): short message explaining that projects are registered via the MCP `start` tool.

Repo-missing state (`branch === null`): card shows `(repo missing)` in place of branch, card body is not clickable, × button remains so the user can clean up.

### `ProjectPalette` component

New file at `frontend/src/components/palette/ProjectPalette.tsx`. Modeled on `SymbolSearch`.

- Fetches projects every time it opens. No caching across opens — state may have changed.
- Text input at the top with placeholder "Switch project…"; auto-focused on open.
- Client-side fuzzy filter over `repoName + slug + repoPath + description`, case-insensitive **subsequence** match (each query char must appear in order). Keep it simple — no scoring, no external library.
- Each row: repo name (bold), branch + PR badge (muted), counts on the right.
- Current project is listed but marked `(current)` and greyed; selecting it is a no-op + close.
- Each row has a small × button visible on hover or when the row is highlighted. Clicking × puts that row into an inline "Remove? Yes / No" state (same pattern as the landing cards). Keyboard users can reach × via Tab within the palette; avoid a dedicated keybind so we don't fight the input's own Cmd+Backspace "delete word" behavior on macOS.
- Keyboard:
  - ↑/↓ navigate · Enter open · Esc close (input keeps focus throughout)
- Mounted globally inside `ProjectView` alongside `SymbolSearch` so it's available from every project view (the landing page has its own navigation UI and does not mount the palette).
- Uses its own CSS under a `project-palette-*` prefix. Visually consistent with `SymbolSearch` (same backdrop treatment, same dialog width and shadow) but no shared class names — keeps the two dialogs independent.

If the user deregisters the currently-open project, navigate to `/` after success.

### Header switcher

In `Header.tsx`, replace the bare `<strong>{meta().repoName}</strong>` with a `<button class="header-project-btn">` containing the same text plus a subtle chevron. The button sits inline in the existing `<h1>`; the branch span and PR anchor that follow stay put. `onClick` sets `paletteOpen(true)`.

### Keyboard shortcut

Add Cmd-K (Ctrl-K on non-Mac) to `useKeyboardShortcuts.ts`:

- Detection: `(e.metaKey || e.ctrlKey) && e.key === 'k'`. `preventDefault()` the event so Firefox doesn't focus its own search bar.
- Existing `k`/`j`/`n`/`p` branches in `useKeyboardShortcuts.ts` do not guard against metaKey. Add `!e.metaKey && !e.ctrlKey` to the bare `k` / `ArrowUp` branch so Cmd-K stops triggering prev-file navigation. (Spot-check the other bare-letter branches while editing, but the known collision is `k`.)
- Does not fire while typing inside comment input fields — reuse the existing `HTMLTextAreaElement || HTMLInputElement` target guard.

## Data flow

```
User presses Cmd-K / clicks header project button / visits /
    ↓
Frontend calls GET /projects
    ↓
Server iterates manager.list(), hydrates each with branch / PR / counts
    ↓
User picks a project
    ↓
window.location.href = /project/<new-slug>/
    ↓
Full page reload → existing per-project flow
```

No polling, no SSE. Stale data is acceptable — the palette opens for a second, the landing page is a jumping-off point.

## Error / edge cases

- **Repo directory missing.** Server returns `branch: null`; UI flags as `(repo missing)` and disables the open action, keeps deregister.
- **Empty list.** Landing page shows help text; palette shows "No projects registered yet."
- **Filter matches nothing.** Palette shows "No matches."
- **Navigating to self.** Palette close, no reload.
- **Deregistering current project.** After `DELETE /projects/:slug` resolves, `window.location.href = '/'`. The live SSE connection will emit `close` on navigation (the server's `req.on('close')` unsubscribes), so no special teardown is required.
- **Navigating to a slug that was just deregistered in another tab.** The target `/project/<slug>/` returns a 404 JSON on its API calls; the project view renders empty. Acceptable — user can reload `/` and pick again. Not worth special-casing.
- **Cmd-K inside an input.** Ignored, same pattern as other keyboard shortcuts.
- **`lgtm-active-item` localStorage leaks across projects.** The key is global today (`App.tsx`) but its value is meaningful only within a single project — once the user starts switching projects via full reload, a stale `"mcp"` or doc-item id from project A can point at a non-existent item in project B. The existence check in `onMount` masks most cases, but the common value `"diff"` collides silently. Fix as part of this work: namespace the key to `lgtm-active-item:<slug>` in `ProjectView`.

## Testing

### Server (`server/__tests__/routes.test.ts`, extend)

- `GET /projects` for a freshly-registered project with no comments returns `branch: 'main'` (or the detected base), zero counts, no PR.
- `GET /projects` for a project with active/resolved/dismissed comments from both authors returns counts that include active+resolved, exclude dismissed, and exclude replies.
- `GET /projects` handles a session whose repoPath no longer exists: returns `branch: null, pr: null`, does not throw, and still returns comment counts (which don't touch git).
- `DELETE /projects/:slug` still works (covered today; extend only if gaps surface).

### Frontend (`frontend/src/__tests__/palette-filter.test.ts`, new)

- Subsequence matcher: case-insensitive, matches across `repoName` / `slug` / `repoPath` / `description`.
- Returns full list when query is empty.
- Returns empty array when no project matches.

## Files touched

- `server/app.ts` — enrich `GET /projects` (no routing changes; `/` is already served by `express.static`)
- `server/__tests__/routes.test.ts` — extend
- `frontend/src/App.tsx` — reduce to a thin router
- `frontend/src/ProjectView.tsx` — new; holds everything that was in the old `App` body, plus `lgtm-active-item:<slug>` namespacing and palette mount
- `frontend/src/api.ts` — export `getProjectSlug`; add `fetchRegisteredProjects`, `deregisterProject`
- `frontend/src/state.ts` — `paletteOpen` signal
- `frontend/src/hooks/useKeyboardShortcuts.ts` — Cmd-K handler; add metaKey guard to bare `k` branch
- `frontend/src/components/header/Header.tsx` — switcher button
- `frontend/src/components/landing/LandingPage.tsx` — new
- `frontend/src/components/palette/ProjectPalette.tsx` — new
- `frontend/src/style.css` — landing + palette styles
- `frontend/src/__tests__/palette-filter.test.ts` — new
