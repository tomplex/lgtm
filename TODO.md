# LGTM — TODO

## Usage nits
- [ ] Auto-reload when git state changes (SSE or polling)
- [ ] Filter commits by message, time, etc

## UI/UX
### Interaction patterns
- [ ] "Ask Claude" button on comments — sends a single comment to the Claude session immediately via channel notification, Claude responds inline (doesn't wait for full review submit)
- [ ] Line range commenting (select multiple lines, leave one comment)

### Information density
- [ ] Too many horizontal bands at top (header, tabs, meta, commits, description) - consolidate
- [ ] Meta bar could fold into header or be on-demand

### Missing capabilities
- [ ] Markdown rendering in comments (both user and Claude)
- [ ] Round-over-round diff (see what changed since last review submission)
- [ ] Multi-round reply/resolve stability — reply keys use `claude:<item>:<serverIndex>` which breaks if Claude adds new comments between rounds (indices shift). Needs stable IDs (UUID per comment, server-side change).

## Features
- [ ] "+" button in tab bar to add document items from the UI (path input, POSTs to `/items`)
- [ ] `GET /files?glob=**/*.md` endpoint to list repo markdown files for a picker
- [ ] Commits window should automatically update as new commits come in
## MCP / Integration
- [ ] Channel notification on submit (push feedback to Claude without polling)
- [ ] Plugin packaging (bundle MCP config, skills, hooks for `claude plugin add`)

## Future
- [ ] Rename GitHub repo to `lgtm`
- [ ] Save user reviews to a persistent location so that review preferences can be learned from
