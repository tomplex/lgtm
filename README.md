# Claude Review

A web-based review UI for collaborating with Claude Code on code changes and documents. One review session per branch, with multiple reviewable items (diffs, specs, design docs) accessible via tabs.

## Goal

Make it easy for a human and Claude to have a structured review conversation. Claude starts a review server at the beginning of a session, adds items as work progresses (specs, code changes), leaves comments for the human to respond to, and reads feedback when the human submits.

## Architecture

Two files, no build step, no dependencies beyond Python 3 and a browser:

```
server.py     -- Python HTTP server (369 lines)
review.html   -- Single-file UI: HTML + CSS + JS (1928 lines)
```

### Server (`server.py`)

A `http.server`-based Python server that:

- Manages a **session** with multiple **review items** (always starts with "Code Changes" diff)
- Serves the HTML UI and a JSON API
- Runs git commands to produce diffs, read file context, detect branches
- Stores Claude's comments in memory, writes user feedback to disk
- Auto-detects base branch (master/main), computes stable port from repo path hash

### UI (`review.html`)

A single self-contained HTML file with inline CSS and JS. External CDN deps: highlight.js (syntax highlighting), marked.js (markdown rendering).

Two view modes, switchable via tabs:
- **Diff view**: file sidebar, syntax-highlighted unified diff, line-level commenting
- **Document view**: rendered markdown with per-block commenting

## API

### GET endpoints

| Endpoint | Description |
|----------|-------------|
| `/` | Serves the HTML UI |
| `/items` | List of review items in the session |
| `/data?item=<id>` | Data for a specific item (diff or document content) |
| `/data?item=diff&commits=sha1,sha2` | Diff scoped to specific commits |
| `/commits` | Branch commit list with metadata |
| `/context?file=<path>&line=<n>&count=<n>&direction=up\|down` | File lines for context expansion |
| `/file?path=<path>` | Full file content (for "show whole file") |

### POST endpoints

| Endpoint | Body | Description |
|----------|------|-------------|
| `/items` | `{path, title, id?}` | Add a document to the session |
| `/comments` | `{item, comments: [{file, line, comment}]}` | Claude seeds comments on an item |
| `/submit` | `{comments}` | User submits review feedback |

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
- One server per branch, always includes "Code Changes" tab
- Documents added dynamically via `POST /items` (shows as new tabs)
- Comments namespaced per item, submitted together
- Tab bar with comment count badges (blue = user, purple = Claude)

### Integration
- Description banner: `--description` flag for review context
- Meta bar: branch name, base branch, repo path, PR link (via `gh`)
- Anchor links: `#file=path/to/file` for deep linking
- Deterministic ports: stable hash of repo path (range 9850-9950)
- Output: `/tmp/claude-review/<branch-slug>.md` with signal file for polling

## Usage

```bash
# Start a review session for the current branch
python3 server.py --repo /path/to/repo

# With description
python3 server.py --repo /path/to/repo --description "Added auth middleware, please check error handling"

# Add a document mid-session
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

# Read user feedback after they submit
cat /tmp/claude-review/<branch-slug>.md
```

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

- **MCP server**: wrap the HTTP API in MCP tools for cleaner Claude integration
- **Vite + TypeScript port**: the HTML file is ~1900 lines; proper modules would help maintainability
- **Notification on submit**: auto-notify the Claude session when the user submits feedback
- **Side-by-side diff**: optional two-column diff view
- **Persistent state**: save comments to disk so they survive page refresh
