# LGTM — TODO

## Bugs
- [x] j/k shortcuts use flat file order, not current view order (phased/grouped)
- [x] Description banner persists over docs and after review submission

## UI polish
- [x] Page title and top bar should show repo/project name prominently, plus branch vs base
- [ ] Too many horizontal bands at top (header, tabs, meta, commits, description) - consolidate; meta bar could fold into header or be on-demand
- [ ] Grouped view group headers are too dense
- [ ] Phased review groups should be collapsible, auto-collapse when all items reviewed
- [ ] Button to dismiss/hide files in the sidebar

## Commenting
- [ ] Markdown rendering in comments (both user and Claude)
- [ ] Line range commenting (select multiple lines, one comment)
- [ ] Whole-file comments (not tied to a specific line)
- [ ] Multi-round reply/resolve stability — reply keys use `claude:<item>:<serverIndex>` which shifts when Claude adds new comments between rounds. Needs stable IDs (UUID per comment, server-side).

## Diff & commits
- [ ] Auto-reload diff when git state changes (SSE push or polling)
- [ ] Filter commits by message, date, author
- [ ] Commits window should auto-update as new commits land
- [ ] Base branch picker in the UI
- [ ] Round-over-round diff (show what changed since last review submission)

## Content management
- [ ] "+" button in tab bar to add document items from the UI (path input, POSTs to `/items`)
- [ ] `GET /files?glob=**/*.md` endpoint to list repo files for a document picker

## MCP / integration
- [ ] Channel notification on submit — push feedback to Claude immediately (requires channels, see docs/channels-research.md)
- [ ] "Ask Claude" button on comments — send a single comment to the Claude session via channel notification, Claude responds inline without waiting for full review submit
- [ ] Plugin packaging (bundle MCP config, skills, hooks for `claude plugin add`)
- [ ] Persistent review storage so review preferences can be learned from across sessions

## Tech debt
- [ ] Comprehensive server tests

## Future
- [ ] Rename GitHub repo to `lgtm`
