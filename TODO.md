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
- [x] Comment persistence (survive page refresh)
- [x] Review progress indicator in header — remaining lines to review, subtracts reviewed files' lines
- [ ] Round-over-round diff (see what changed since last review submission)
- [ ] Multi-round reply/resolve stability — reply keys use `claude:<item>:<serverIndex>` which breaks if Claude adds new comments between rounds (indices shift). Needs stable IDs (UUID per comment, server-side change).

## Features
- [ ] "+" button in tab bar to add document items from the UI (path input, POSTs to `/items`)
- [ ] `GET /files?glob=**/*.md` endpoint to list repo markdown files for a picker
- [ ] Commits window should automatically update as new commits come in
- [x] When on main, commits should still show up and be reviewable

## MCP server
Singleton server with MCP at `/mcp`, multi-project via `/project/:slug/`. Keyed by repo path.

- [x] `review_start(repo, description?)` — register project, return URL (idempotent)
- [x] `review_add_document(repo, path, title)` — add document tab
- [x] `review_comment(repo, item, comments)` — seed Claude comments
- [x] `review_status()` — list registered projects with feedback status
- [x] `review_read_feedback(repo)` — read submitted review feedback
- [x] `review_stop(repo)` — deregister project
- [ ] Channel notification on submit (push feedback to Claude without polling)
- [ ] Plugin packaging (bundle MCP config, skills, hooks for `claude plugin add`)

## Future
- [ ] Rename to LGTM
- [ ] Save user reviews to a perisistent location so that review preferences can be learned from
