# Phase 2: Multi-Project Singleton Server

Convert the server from a single-session CLI tool to a long-running singleton that manages multiple review projects. Projects are registered dynamically and accessed via path-based routing.

## Motivation

Phase 3 adds MCP, where one MCP server manages reviews across multiple repos/worktrees. The HTTP server needs to support multiple concurrent projects first. This phase makes the server multi-project without adding MCP — the registration API (`POST /projects`) is what MCP tools will call in phase 3.

## SessionManager

New module: `server/session-manager.ts`

A `Map<string, Session>` wrapper that manages the lifecycle of review sessions.

### Interface

```typescript
class SessionManager {
  register(repoPath: string, opts?: { description?: string; baseBranch?: string }): { slug: string; url: string }
  get(slug: string): Session | undefined
  list(): Array<{ slug: string; repoPath: string; description: string }>
  deregister(slug: string): boolean
}
```

### Slug derivation

`basename(repoPath)` lowercased, non-alphanumeric characters replaced with `-`. If the slug already exists and points to a different path, append a counter (`lgtm-2`). If the slug already exists for the same path, return the existing session (idempotent registration).

### Session creation

On `register()`:
- Auto-detect base branch if not provided
- Create output path: `/tmp/claude-review/<slug>.md`
- Initialize empty output file
- Create Session instance
- Store in map

## API changes

### New top-level routes

- `POST /projects` — register a project
  - Body: `{ repoPath: string, description?: string, baseBranch?: string }`
  - Returns: `{ ok: true, slug: string, url: string }` where url is the full browser URL
  - Idempotent: re-registering the same path returns the existing slug
- `GET /projects` — list all registered projects
  - Returns: `{ projects: Array<{ slug, repoPath, description }> }`
- `DELETE /projects/:slug` — deregister a project
  - Returns: `{ ok: true }`

### Project-scoped routes

All existing routes move under `/project/:slug/`. The route handler resolves the slug to a Session via SessionManager. If the slug doesn't exist, return 404 `{ error: "Project not found: <slug>" }`.

Routes (identical behavior to current, just scoped):
- `GET /project/:slug/items`
- `GET /project/:slug/data`
- `GET /project/:slug/context`
- `GET /project/:slug/file`
- `GET /project/:slug/commits`
- `GET /project/:slug/events` (SSE)
- `GET /project/:slug/analysis`
- `POST /project/:slug/items`
- `POST /project/:slug/comments`
- `POST /project/:slug/submit`
- `POST /project/:slug/analysis`
- `DELETE /project/:slug/comments`

### Implementation

`createApp` changes signature from `createApp(session: Session)` to `createApp(manager: SessionManager)`. The project-scoped routes use an Express Router mounted at `/project/:slug`, with middleware that resolves the session:

```typescript
router.use((req, res, next) => {
  const session = manager.get(req.params.slug);
  if (!session) return res.status(404).json({ error: `Project not found: ${req.params.slug}` });
  req.session = session;  // or res.locals.session
  next();
});
```

The existing route handlers change from using a closed-over `session` variable to reading from `res.locals.session`.

## Frontend changes

### Slug extraction

The frontend reads the project slug from the URL path. In `api.ts` or a new config module:

```typescript
function getProjectSlug(): string {
  const match = window.location.pathname.match(/^\/project\/([^/]+)/);
  return match?.[1] ?? '';
}
```

### API prefix

All fetch calls in `api.ts` prepend `/project/<slug>` to the URL. The simplest approach: a `baseUrl()` function that returns `/project/<slug>` and is prepended to every fetch path.

```typescript
function baseUrl(): string {
  return `/project/${getProjectSlug()}`;
}

// example: fetch(`${baseUrl()}/items`)
```

This is the only frontend change. No state, rendering, or component changes needed.

### Vite dev proxy

The frontend's `vite.config.ts` proxy needs to forward `/project/*` and `/projects` to the backend (in addition to the existing API routes). Update the proxy config to forward all non-static requests.

## Static file serving

The SPA (`frontend/dist/`) needs to be served for both `/project/<slug>/` and any sub-paths. Express static middleware serves assets from `frontend/dist/`. A catch-all route serves `index.html` for any `/project/*` path that doesn't match an API route.

Root `/` can redirect to `/projects` or serve a minimal page. Not critical for this phase — phase 3 MCP will direct the browser to specific project URLs.

## Server entry point

`server.ts` changes:
- No required args. Server starts and listens, ready for project registrations.
- `--port` flag (optional, defaults to 9900)
- `--repo` flag preserved as convenience: auto-registers one project on startup and opens the browser to its URL. This keeps the existing dev workflow working.

## File structure changes

```
server/
  session-manager.ts   -- NEW: SessionManager class
  session.ts           -- unchanged
  git-ops.ts           -- unchanged
  app.ts               -- modified: createApp(manager), project-scoped router
  server.ts            -- modified: simplified entry point
```

## Out of scope

- MCP server integration (phase 3)
- Channel notifications (phase 3)
- Project picker UI at root `/` (future, when needed)
- Stable comment IDs (tracked in TODO, independent of this work)
