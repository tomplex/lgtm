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
  claudeCommentCount: number;                // top-level active claude comments
  userCommentCount: number;                  // active user comments awaiting submit
}
```

- `branch`, `baseBranch`, and `pr` come from `getRepoMeta(session.repoPath, session.baseBranch)` in `git-ops.ts`.
- Comment counts come from `session.listComments({ status: 'active' })`, partitioned by `author` and filtered to top-level (`parentId == null`).
- Each project is wrapped in try/catch. If the repo directory no longer exists or git fails, return `branch: null, pr: null` and zero counts rather than failing the whole endpoint. The UI uses `branch: null` as the "repo missing" signal.

### SPA fallback at `/`

`app.ts` already serves `index.html` for `/project/{*path}`. Add a root-level fallback so `index.html` is served at `/` too. Static assets under `/assets/...` continue to be handled by `express.static`.

## Frontend changes

### Routing

In `App.tsx`, branch on slug presence before mounting the project view:

```ts
if (!getProjectSlug()) return <LandingPage />;
```

`getProjectSlug()` already exists in `api.ts`. All existing per-project state (items, comments, analysis, SSE) stays scoped to the slug as today.

`api.ts` gets two new root-level helpers that do not use `baseUrl()`:

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
- Keyboard:
  - ↑/↓ navigate · Enter open · Esc close
  - Cmd+Backspace on the highlighted row → inline "confirm delete?" on that row; a second Cmd+Backspace confirms, anything else cancels
- Mounted globally in `App.tsx` alongside `SymbolSearch` so it's available from every project view.
- Uses its own CSS under a `project-palette-*` prefix. Visually consistent with `SymbolSearch` (same backdrop treatment, same dialog width and shadow) but no shared class names — keeps the two dialogs independent.

If the user deregisters the currently-open project, navigate to `/` after success.

### Header switcher

In `Header.tsx`, wrap the existing repo-name `<strong>` in a `<button class="header-project-btn">` with the same visuals plus a subtle chevron. `onClick` sets `paletteOpen(true)`. The existing branch / PR display to the right is unchanged.

### Keyboard shortcut

Add Cmd-K (Ctrl-K on non-Mac) to `useKeyboardShortcuts.ts`:

- When `paletteOpen()` is false, opens the palette.
- When open, the palette's own handlers take over (Esc closes).
- Does not fire while typing inside comment input fields (standard ignore-when-focused-on-input guard, consistent with other shortcuts).

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
- **Deregistering current project.** After success, navigate to `/`.
- **Cmd-K inside an input.** Ignored, same pattern as other keyboard shortcuts.

## Testing

### Server (`server/__tests__/routes.test.ts`, extend)

- `GET /projects` returns enriched fields for a registered project with at least one comment of each type.
- `GET /projects` handles a session whose repoPath no longer exists: returns `branch: null, pr: null`, and zero counts, without throwing.
- `DELETE /projects/:slug` still works (covered today; extend only if gaps surface).

### Frontend (`frontend/src/__tests__/palette-filter.test.ts`, new)

- Subsequence matcher: case-insensitive, matches across `repoName` / `slug` / `repoPath` / `description`.
- Returns full list when query is empty.
- Returns empty array when no project matches.

## Files touched

- `server/app.ts` — enrich `GET /projects`, add `/` SPA fallback
- `server/__tests__/routes.test.ts` — extend
- `frontend/src/App.tsx` — branch on slug presence, mount palette globally
- `frontend/src/api.ts` — `fetchRegisteredProjects`, `deregisterProject`
- `frontend/src/state.ts` — `paletteOpen` signal
- `frontend/src/hooks/useKeyboardShortcuts.ts` — Cmd-K handler
- `frontend/src/components/header/Header.tsx` — switcher button
- `frontend/src/components/landing/LandingPage.tsx` — new
- `frontend/src/components/palette/ProjectPalette.tsx` — new
- `frontend/src/style.css` — landing + palette styles
- `frontend/src/__tests__/palette-filter.test.ts` — new
