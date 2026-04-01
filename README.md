# LGTM

A review UI for collaborating with Claude Code on code changes and documents. Claude registers a project, seeds comments, adds docs for review - and the human reviews everything in a browser-based diff viewer, then submits feedback that Claude can read.

## Install

Requires [Node.js](https://nodejs.org/) 20+.

```bash
npm install
npm run dev:all    # server (hot-reload) + frontend (HMR), pointed at current repo
```

Or separately:

```bash
npm run dev -- --repo . --port 9900   # server only
npm run dev:frontend                   # frontend only (proxies to server)
npm run build && npm start -- --repo . # production build
```

## MCP

LGTM exposes an MCP server at `/mcp` on the same port as the web UI. Claude Code connects to it for native tool access - no curl or shell commands needed.

Add it to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "lgtm": {
      "type": "http",
      "url": "http://localhost:9900/mcp"
    }
  }
}
```

Or manually:

```bash
claude mcp add --transport http lgtm http://localhost:9900/mcp
```

### Tools

| Tool | What it does |
|------|-------------|
| `review_start` | Register a project for review (idempotent), returns browser URL |
| `review_add_document` | Add a markdown/text doc as a review tab |
| `review_comment` | Seed Claude's comments on the diff or a document |
| `review_set_analysis` | Set file priorities, review strategy, groupings |
| `review_status` | List registered projects and whether feedback has been submitted |
| `review_read_feedback` | Read the user's submitted review |
| `review_stop` | Deregister a project |

## Architecture

One TypeScript/Express server handles everything: the web UI, the project-scoped review API, and the MCP endpoint. Multiple projects can be registered simultaneously, each scoped under `/project/:slug/`.

```
server/
  server.ts            -- entry point, starts Express on port 9900
  app.ts               -- Express routes, project-scoped router, static files
  mcp.ts               -- MCP server setup, tool definitions, Streamable HTTP transport
  session.ts           -- Session class (items, comments, SSE, review submission)
  session-manager.ts   -- manages multiple Sessions keyed by repo path
  git-ops.ts           -- shells out to git for diffs, commits, file context
  parse-analysis.ts    -- parses analysis markdown into structured data
  slugify.ts           -- slug derivation
frontend/
  src/
    main.ts            -- entry point, SSE connection, init
    api.ts             -- HTTP client (auto-prefixes project slug from URL)
    state.ts           -- shared mutable state, types
    diff.ts            -- diff parsing, rendering, context expansion
    document.ts        -- markdown document view with block commenting
    comments.ts        -- comment CRUD, review output formatting
    claude-comments.ts -- Claude comment rendering (reply/resolve/dismiss)
    ui.ts              -- tabs, keyboard shortcuts, review submission
    file-list.ts       -- sidebar file list (flat, grouped, phased views)
    commit-picker.ts   -- commit selection panel
    analysis.ts        -- file sorting/grouping by analysis data
    persistence.ts     -- localStorage for comments and UI state
    utils.ts           -- escaping, syntax detection, highlighting
  index.html
  style.css
frontend/dist/         -- production build (committed, served by Express)
```

### How it fits together

The server is a singleton that manages multiple review projects. Each project is a `Session` with its own diff, documents, comments and SSE clients. Projects are registered dynamically - either via `POST /projects`, the MCP `review_start` tool, or the `--repo` CLI convenience flag.

The frontend is vanilla TypeScript with no framework. It extracts the project slug from the URL path (`/project/:slug/`) and prefixes all API calls accordingly. SSE keeps the UI live when Claude posts comments or adds documents.

The MCP server runs on the same Express app at `/mcp` using Streamable HTTP transport. Claude Code connects over HTTP and calls tools that are thin wrappers around `SessionManager` and `Session` methods.

## Features

**Diff review**: syntax-highlighted unified diff with word-level change highlighting, context expansion, whole-file view, commit picker. Click any line to comment. On main branch, shows recent commits for selection.

**Document review**: rendered markdown with per-block commenting. Claude can comment on specific blocks.

**Claude comments**: reply, resolve, or dismiss. Replies nest inside the comment card. Resolved comments fade with a badge. All interactions included in submitted review output.

**Analysis layer**: Claude can set file priorities (critical/important/normal/low), review phases (review/skim/rubber-stamp), and logical groupings. The sidebar supports flat, grouped and phased views.

**Review output**: submitted as structured markdown to `/tmp/claude-review/<slug>.md` with `**Claude:**` / `**Reply:**` / `**Status:** Resolved` labels for Claude comment interactions.

## Development

```bash
npm run dev:all     # hot-reload server + HMR frontend, pointed at this repo
npm run lint        # eslint for server/ and frontend/
npm run build       # compile server + build frontend
```

`npm run dev:all` uses `concurrently` to run `tsx --watch` (server, auto-restarts on changes) and Vite (frontend HMR) in parallel. Browser only opens on first start, not on hot-reload restarts.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `j`/`k` or arrows | Navigate files |
| `f` | Focus file search |
| `e` | Toggle current file as reviewed |
| `c` | Toggle commit picker |
| `n`/`p` | Jump to next/prev comment |
| `w` | Toggle whole file view |
| `r` | Refresh |
| `Cmd+Enter` | Save comment |
| `Esc` | Cancel comment / clear search |
