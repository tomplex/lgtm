# Phase 1: Python to TypeScript Server Migration

Mechanical port of the backend from Python/FastAPI to TypeScript/Express. Same HTTP API, same behavior, same frontend. Structured so that phases 2 (multi-project singleton) and 3 (MCP server + channels) can be added without restructuring.

## Motivation

The end goal is a single process that serves both the browser UI (HTTP) and Claude Code (MCP over Streamable HTTP), with channel notifications for pushing review events to Claude. The MCP TypeScript SDK is required for channel support. Rather than bridging two runtimes, we migrate the backend to TypeScript so everything runs in one process, one language.

## What gets ported

### git-ops.ts (from git_ops.py)

Same functions, same behavior. Shell out to git via `child_process.execFileSync`, parse stdout.

Functions:
- `detectBaseBranch(repoPath)` — check for master/main
- `getBranchDiff(repoPath, baseBranch)` — merge-base diff scoped to branch files
- `getSelectedCommitsDiff(repoPath, shas)` — diff for specific commits
- `getBranchCommits(repoPath, baseBranch)` — commit list with metadata
- `getRepoMeta(repoPath, baseBranch)` — branch, base, repo name, PR info (via `gh`)
- `getFileLines(repoPath, filepath, start, count, direction)` — context expansion
- `gitRun(repoPath, ...args)` — low-level git command runner

### session.ts (from Session class in server.py)

The Session class extracted into its own module. This is important for phase 2 — the singleton server will manage multiple Session instances, and the MCP layer will interact with them directly.

- Same in-memory state: items, claude comments, round counter, SSE client queues
- Same methods: `getItemData`, `addItem`, `addComments`, `deleteComment`, `clearComments`, `submitReview`, `subscribe`, `unsubscribe`, `broadcast`
- TypeScript interfaces for all data shapes (`SessionItem`, `ClaudeComment`, `RepoMeta`, etc.)

### app.ts (from FastAPI routes in server.py)

A function `createApp(session: Session): Express` that builds and returns the Express app. Not a global — takes a Session and returns a configured app. This is the key structural decision for phase 2: when we move to multi-project, this becomes `createApp(sessionManager)` instead.

Routes (identical API contract to current):

GET:
- `/items` — list review items
- `/data?item=<id>&commits=<shas>` — item data (diff or document)
- `/context?file=<path>&line=<n>&count=<n>&direction=up|down` — context expansion
- `/file?path=<path>` — full file content
- `/commits` — branch commit list
- `/events` — SSE stream
- `/analysis` — get analysis data

POST:
- `/items` — add document item
- `/comments` — add Claude comments
- `/submit` — submit review
- `/analysis` — set analysis data

DELETE:
- `/comments?item=<id>&index=<n>` — delete comment(s)

Static files: `express.static` serving `frontend/dist/`, with `index.html` fallback.

### server.ts (from main() in server.py)

CLI entry point. Parses args, creates Session, calls `createApp`, starts listening. Temporary — this goes away in phase 2 when the server starts without args and projects are registered dynamically.

- Same CLI flags: `--repo`, `--base`, `--description`, `--port`, `--output`
- Same startup protocol: `REVIEW_URL=`, `REVIEW_OUTPUT=`, `REVIEW_PID=` on stdout
- Opens browser on startup (controlled by flag, default on for CLI mode)
- `stable_port_for_path` hash function preserved

## File structure

```
server/
  git-ops.ts       -- git operations
  session.ts       -- Session class and data interfaces
  app.ts           -- createApp() function, Express routes
  server.ts        -- CLI entry point (temporary)
package.json       -- root package.json, replaces pyproject.toml
tsconfig.json      -- TypeScript config for server/
frontend/          -- unchanged
```

The root `package.json` handles both the server and references the frontend workspace. The server compiles to `dist/server/` (or similar), separate from `frontend/dist/`.

## Dependencies

- `express` + `@types/express` — HTTP framework
- `open` — browser launcher (optional, for CLI mode)
- `typescript` — build
- `tsx` — dev mode (run .ts directly without compiling)
- `@types/node` — Node.js types

No SSE library — hand-rolled with Express `res.write()` (~20 lines). Avoids a dependency and keeps compatibility with future MCP SDK integration simple.

No arg parsing library for now — `process.argv` manual parsing or `minimist` (tiny, no opinions). The CLI is temporary.

## What doesn't change

- Frontend code (already TypeScript, same API contract)
- The HTTP API (all endpoints, request/response shapes identical)
- The review output format (markdown to `/tmp/claude-review/<slug>.md`)
- The signal file mechanism (`.signal` file on submit)
- `frontend/dist/` serving behavior

## What gets removed

- `server.py`
- `git_ops.py`
- `pyproject.toml`
- `.venv/` and any Python-related config

## Structural decisions for forward compatibility

These choices don't add features but ensure phases 2 and 3 don't require restructuring:

1. **Session is its own module** — phase 2 wraps it in a SessionManager, phase 3 MCP tools call Session methods directly
2. **`createApp` is a function, not a global** — phase 2 passes a SessionManager instead of a single Session
3. **SSE is hand-rolled** — no library conflicts with MCP SDK
4. **No stdout dependency for lifecycle** — stdout protocol preserved for now but nothing relies on it internally. Phase 3 replaces it with MCP channel notifications.
5. **Browser open is a flag** — phase 3 MCP mode won't auto-open

## Verification

The migrated server is correct when:
- `npm start -- --repo /path/to/repo` starts the server and opens the browser
- All existing frontend interactions work identically (diff view, document view, comments, commit picker, file search, keyboard shortcuts)
- `POST /comments`, `POST /items`, `POST /submit` work via curl
- SSE events fire on comment/item changes
- Review output file is written correctly on submit

## Out of scope

- Multi-project support (phase 2)
- MCP server integration (phase 3)
- Channel notifications (phase 3)
- Any new features
