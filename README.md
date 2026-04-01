# LGTM

A web-based review UI for collaborating with Claude Code on code changes and documents. One review session per branch, with multiple reviewable items (diffs, specs, design docs) accessible via tabs.

## Goal

Make it easy for a human and Claude to have a structured review conversation. Claude starts a review server at the beginning of a session, adds items as work progresses (specs, code changes), leaves comments for the human to respond to, and reads feedback when the human submits.

## Install

Requires [Node.js](https://nodejs.org/) 20+.

```bash
# from a local clone
npm install
npm run dev -- --repo .

# or build and run
npm run build
npm start -- --repo .
```

## Usage

```bash
# start a review session for the current branch
lgtm --repo /path/to/repo

# with a description banner
lgtm --repo /path/to/repo --description "Added auth middleware, please check error handling"

# add a document mid-session
curl -X POST http://127.0.0.1:<port>/items \
  -H 'Content-Type: application/json' \
  -d '{"path": "/path/to/spec.md", "title": "Design Spec"}'

# Claude leaves a comment on code
curl -X POST http://127.0.0.1:<port>/comments \
  -H 'Content-Type: application/json' \
  -d '{"item": "diff", "comments": [{"file": "src/foo.ts", "line": 42, "comment": "Does this handle null?"}]}'

# Claude leaves a comment on a document
curl -X POST http://127.0.0.1:<port>/comments \
  -H 'Content-Type: application/json' \
  -d '{"item": "design-spec", "comments": [{"block": 3, "comment": "Should we cover error handling here?"}]}'

# read user feedback after they submit
cat /tmp/claude-review/<branch-slug>.md
```

## Architecture

TypeScript server (Express) with a Vite + vanilla TypeScript frontend.

```
server/
  server.ts              -- CLI entry point
  app.ts                 -- Express app, routes, SSE
  session.ts             -- Session class, data types
  git-ops.ts             -- git operations (diff, commits, file context)
frontend/
  src/
    main.ts              -- entry point
    api.ts               -- HTTP client for server API
    state.ts             -- shared application state
    utils.ts             -- helpers (escaping, debounce, syntax detection)
    diff.ts              -- diff parsing, rendering, context expansion
    document.ts          -- markdown document view with block commenting
    comments.ts          -- comment creation, display, navigation
    ui.ts                -- sidebar, tabs, header, keyboard shortcuts
  index.html             -- shell HTML
  style.css              -- all styles
  vite.config.ts         -- Vite config with dev proxy to server
  package.json
frontend/dist/           -- production build output (served by server)
```

### Backend (`server/`)

An Express-based TypeScript server that:

- Manages a **session** with multiple **review items** (always starts with "Code Changes" diff)
- In production, serves the built frontend from `frontend/dist/`
- Exposes a JSON API for diffs, commits, file context, comments and review submission
- Stores Claude's comments in memory, writes user feedback to disk
- Auto-detects base branch (master/main), computes stable port from repo path hash

Git operations (running git commands, parsing output) are in `server/git-ops.ts`.

### Frontend (`frontend/`)

Vite + vanilla TypeScript. No framework - just typed modules and direct DOM manipulation. External deps: highlight.js (syntax highlighting), marked.js (markdown rendering).

Two view modes, switchable via tabs:
- **Diff view**: file sidebar, syntax-highlighted unified diff, line-level commenting
- **Document view**: rendered markdown with per-block commenting

**Dev mode**: `npm run dev` inside `frontend/` starts Vite's dev server with HMR. API requests are proxied to the backend (start it separately).

**Production mode**: `npm run build` outputs to `frontend/dist/`. The server serves these static files directly - no separate frontend process needed.

## API

### Project management

| Endpoint | Description |
|----------|-------------|
| `POST /projects` | Register a project `{ repoPath, description?, baseBranch? }` |
| `GET /projects` | List registered projects |
| `DELETE /projects/:slug` | Deregister a project |

### Project-scoped endpoints (under `/project/:slug/`)

| Endpoint | Description |
|----------|-------------|
| `GET /items` | List of review items in the session |
| `GET /data?item=<id>` | Data for a specific item (diff or document content) |
| `GET /data?item=diff&commits=sha1,sha2` | Diff scoped to specific commits |
| `GET /commits` | Branch commit list with metadata |
| `GET /context?file=<path>&line=<n>&count=<n>&direction=up\|down` | File lines for context expansion |
| `GET /file?path=<path>` | Full file content (for "show whole file") |
| `GET /events` | SSE stream for live updates |
| `POST /items` | Add a document `{path, title, id?}` |
| `POST /comments` | Claude seeds comments `{item, comments: [{file, line, comment}]}` |
| `POST /submit` | User submits review feedback `{comments}` |
| `DELETE /comments` | Remove Claude comments |

### MCP endpoint

| Endpoint | Description |
|----------|-------------|
| `POST /mcp` | MCP Streamable HTTP transport (tools + sessions) |
| `GET /mcp` | MCP SSE stream (for active sessions) |

Connect from Claude Code:
```bash
claude mcp add --transport http lgtm http://localhost:9900/mcp
```

MCP tools: `review_start`, `review_add_document`, `review_comment`, `review_status`, `review_read_feedback`, `review_stop`

## Features

### Diff review
- Auto-detected branch diff (merge-base to HEAD, scoped to branch's own files)
- Syntax highlighting via highlight.js, language detected from file extension
- Word-level diff highlighting on adjacent add/del line pairs
- Expand context above/below hunks (fetches from actual file)
- Small gaps between hunks auto-fill
- "Show whole file" with added lines highlighted
- Commit picker: filter diff to specific commits
- File search (`f`), reviewed file marking (`e`), comment navigation (`n`/`p`)
- Resizable sidebar, two-line file names (dir + basename)

### Document review
- Markdown rendered via marked.js with syntax-highlighted code blocks
- Per-block commenting (click any paragraph, heading, list, code block)
- Claude can comment on specific blocks

### Session model
- Singleton server managing multiple projects (one per repo path)
- Projects registered dynamically via `POST /projects` or MCP `review_start`
- Each project has its own "Code Changes" tab plus dynamically added documents
- Comments namespaced per item, submitted together
- Tab bar with comment count badges (blue = user, purple = Claude)

### Integration
- MCP server at `/mcp` for native Claude Code tool access
- Description banner via `--description` flag or MCP `review_start`
- Meta bar: branch name, base branch, repo path, PR link (via `gh`)
- Anchor links: `#file=path/to/file` for deep linking
- Output: `/tmp/claude-review/<slug>.md` with signal file for polling

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `j`/`k` or arrows | Navigate files |
| `f` | Focus file search |
| `e` | Toggle current file as reviewed |
| `c` | Toggle commit picker |
| `n`/`p` | Jump to next/prev comment |
| `r` | Refresh |
| `Cmd+Enter` | Save comment |
| `Esc` | Cancel comment / clear search |

## Future work

- **Channel notifications**: auto-notify the Claude session when the user submits feedback
- **Side-by-side diff**: optional two-column diff view
- **Plugin packaging**: bundle as a Claude Code plugin with MCP config, skills, and hooks
