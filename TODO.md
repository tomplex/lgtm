# LGTM — TODO

## Bugs
- [x] j/k shortcuts use flat file order, not current view order (phased/grouped)
- [x] Description banner persists over docs and after review submission
- [x] Replying to or deleting a comment resets the diff viewer to the first file (fixed by Solid migration — reactive state, no full re-renders)
- [x] Claude comment line matching wrong (diff array indices vs file line numbers) — fixed: all comments now use absolute line numbers
- [x] frontend doesn't remember what tab was open on refresh

## UI polish
- [x] Page title and top bar should show repo/project name prominently, plus branch vs base
- [ ] Too many horizontal bands at top (header, tabs, meta, commits, description) - consolidate; meta bar could fold into header or be on-demand
- [ ] Grouped view group headers are too dense
- [ ] Phased review groups should be collapsible, auto-collapse when all items reviewed
- [x] Flat file view: sort files with Claude comments to the top
- [ ] Button to dismiss/hide files in the sidebar
- [ ] Move comment save / delete buttons for inline interactions to the left hand side for easier access

## Commenting
- [x] Markdown rendering in comments (both user and Claude)
- [ ] Line range commenting (select multiple lines, one comment)
- [x] Comments in whole-file view (shared DiffLine component via Solid migration)
- [x] Multi-round reply/resolve stability — reply keys use `claude:<item>:<serverIndex>` which shifts when Claude adds new comments between rounds. Needs stable IDs (UUID per comment, server-side).

## Diff & commits
- [x] Auto-reload diff when git state changes (SSE push or polling)
- [ ] Filter commits by message, date, author
- [x] Commits window should auto-update as new commits land (git_changed SSE → handleRefresh → fetchCommits)
- [ ] Base branch picker in the UI
- [ ] Round-over-round diff (show what changed since last review submission)

## Content management
- [x] "+" button in tab bar to add document items from the UI (path input, POSTs to `/items`)
- [x] `GET /files?glob=**/*.md` endpoint to list repo files for a document picker

## MCP / integration
- [x] Channel notification on submit — push feedback to Claude immediately (requires `--dangerously-load-development-channels server:lgtm`)
- [x] "Ask Claude" button on comments — send a single comment to the Claude session via channel notification, Claude responds inline via `reply` MCP tool
- [x] Plugin packaging (bundle MCP config, skills, hooks for `claude plugin add`)
- [ ] Persistent review storage so review preferences can be learned from across sessions
- [x] document review submissions should be connected to a specific claude instance rather than the project as a whole

## Tech debt
- [ ] Comprehensive server tests

## Future
- [ ] Rename GitHub repo to `lgtm`
- [ ] Peek definition: upgrade from ripgrep heuristics to tree-sitter for accurate symbol resolution (Python + TS grammars, server-side Node bindings)
