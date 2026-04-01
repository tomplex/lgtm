# LGTM — TODO

## Refactor
- [x] Vite + vanilla TS frontend (split review.html into modules)
- [x] Clean up Python server (extract git ops, reduce globals)
- [x] Dev mode (Vite proxy) + production mode (serve dist/)

## Usage nits
- [x] File filter wildcarding (e.g. `!test` to exclude test files, `*.py`)
- [x] Hotkey to toggle between whole file and diff view
- [ ] Auto-reload when git state changes (SSE or polling)
- [ ] Filter commits by message, time, etc

## UI/UX
### Sizing and placement
- [x] Comment boxes too bulky — tightened padding, borders, inline actions
- [x] Delete button too small — now an always-visible inline action link
- [x] Tab bar / item selector too compact
- [x] Commit panel action buttons too small

### Interaction patterns
- [x] Reply/resolve flow for Claude comments (not just dismiss)
- [ ] "Ask Claude" button on comments — sends a single comment to the Claude session immediately via channel notification, Claude responds inline (doesn't wait for full review submit)
- [x] Larger click targets for commenting - click the line, not just the line number
- [ ] Line range commenting (select multiple lines, leave one comment)

### Information density
- [ ] Too many horizontal bands at top (header, tabs, meta, commits, description) - consolidate
- [ ] Meta bar could fold into header or be on-demand

### Missing capabilities
- [ ] Markdown rendering in comments (both user and Claude)
- [ ] Comment persistence (survive page refresh)
- [x] Review progress indicator in header — remaining lines to review, subtracts reviewed files' lines
- [ ] Round-over-round diff (see what changed since last review submission)
- [ ] Multi-round reply/resolve stability — reply keys use `claude:<item>:<serverIndex>` which breaks if Claude adds new comments between rounds (indices shift). Needs stable IDs (UUID per comment, server-side change).

## Features
- [ ] "+" button in tab bar to add document items from the UI (path input, POSTs to `/items`)
- [ ] `GET /files?glob=**/*.md` endpoint to list repo markdown files for a picker
- [ ] Commits window should automatically update as new commits come in
- [ ] When on main, commits should still show up and be reviewable

## MCP server
Singleton session manager — one MCP server manages all review sessions. Does NOT own git ops or UI; those stay in the HTTP server. Keyed by repo path (worktrees are distinct paths, so they get separate sessions naturally).

- [ ] `review_start(repo, description?)` — spawn HTTP server or return existing one (idempotent)
- [ ] `review_add_document(repo, path, title)` — proxy to the right HTTP server
- [ ] `review_comment(repo, item, comments)` — seed Claude comments on the right server
- [ ] `review_status()` — list running sessions, pending feedback
- [ ] `review_read_feedback(repo)` — get submitted comments
- [ ] `review_stop(repo)` — kill the server
- [ ] Channel notification on submit (push feedback to Claude without polling)

## Future
- [ ] Rename to LGTM
