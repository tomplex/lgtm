# LGTM

A browser-based code review UI for collaborating with Claude Code. Claude registers a project, seeds inline comments on the diff, adds documents for review, and runs analysis to prioritize files. You review everything in the browser and submit feedback that Claude reads and acts on.

![LGTM screenshot](images/Screenshot%202026-04-01%20at%203.53.15%20PM.png)

## Install as a Claude Code plugin

The simplest way to use LGTM is as a Claude Code plugin. This gives you the `/lgtm` command, auto-starts the server, and connects MCP tools automatically.

```bash
claude plugin add tomplex/lgtm
```

Once installed, the server starts automatically when you open a Claude Code session (via a SessionStart hook). No manual MCP configuration needed - the plugin bundles its own `.mcp.json`. Just type `/lgtm` or ask Claude to review your changes.

### Channels (real-time feedback)

For submitted reviews and direct questions to push back to Claude immediately (rather than requiring Claude to poll with `read_feedback`), start Claude Code with the development channels flag:

```bash
claude --dangerously-load-development-channels plugin:lgtm@tomplex-lgtm
```

Without this flag, everything still works - Claude just needs to call `read_feedback` to see your review comments.

### What the plugin provides

- **`/lgtm` command** - registers the current project and opens the review UI
- **`/lgtm analyze` skill** - dispatches agents to classify files by priority and generate a review strategy
- **MCP tools** - Claude can start reviews, post comments, add documents, read your feedback
- **SessionStart hook** - auto-starts the LGTM server on port 9900 if it isn't already running
- **Sub-agents** - file-classifier and synthesizer agents for AI-powered analysis

### Requirements

- [Node.js](https://nodejs.org/) 20+
- Claude Code CLI

Dependencies are installed automatically on first session start. No manual build step needed.

## How it works

You're working with Claude on a feature branch. When you're ready for review (or want Claude to review its own work), Claude registers the project with LGTM and opens a browser tab. The diff viewer shows your branch changes with syntax highlighting, word-level change detection, and inline commenting.

Claude can seed comments on specific lines before you even start reading. You reply, resolve, or dismiss those comments inline. When you're done, you submit your review - Claude reads the structured feedback and can act on it in the same session.

The review loop is iterative. Claude addresses feedback, you refresh the diff, post more comments. Back and forth until it's right.

### Analysis

Claude can also run an analysis pass that classifies every file in the diff by priority (critical / important / normal / low) and review phase (review / skim / rubber-stamp), then groups files thematically with a suggested review strategy. The sidebar switches between flat, grouped and phased views based on this analysis.

## MCP tools

| Tool | What it does |
|------|-------------|
| `start` | Register a project for review (idempotent), returns browser URL |
| `add_document` | Add a markdown/text doc as a review tab |
| `comment` | Post inline comments on the diff or a document |
| `set_analysis` | Set file priorities, review strategy, groupings |
| `claim_reviews` | Claim files for review (marks as in-progress) |
| `read_feedback` | Read the user's submitted review |
| `reply` | Reply to a specific comment |
| `stop` | Deregister a project |

## Architecture

One TypeScript/Express server handles everything: the web UI, the review API, and the MCP endpoint. Multiple projects can be registered simultaneously, each scoped under `/project/:slug/`.

The frontend is SolidJS. It extracts the project slug from the URL path and prefixes all API calls accordingly. SSE keeps the UI live when Claude posts comments or adds documents.

Sessions persist to a SQLite database at `~/.lgtm/data.db`, so review state survives server restarts.

```
server/
  server.ts            -- entry point, CLI args, Express on port 9900
  app.ts               -- routes, project-scoped router, static file serving
  mcp.ts               -- MCP server, tool definitions, Streamable HTTP transport
  session.ts           -- Session class (items, comments, SSE, file review state)
  session-manager.ts   -- manages Sessions keyed by repo path
  store.ts             -- SQLite persistence
  git-ops.ts           -- shells out to git for diffs, commits, file content
  parse-analysis.ts    -- parses analysis markdown into structured data
  symbol-lookup.ts     -- peek-definition via ripgrep heuristics
  comment-store.ts     -- comment CRUD and filtering

frontend/src/
  App.tsx              -- main app component, item loading, keyboard shortcuts
  state.ts             -- SolidJS signals, shared state, types
  api.ts               -- HTTP client (auto-prefixes project slug)
  diff.ts              -- unified diff parsing, context expansion
  components/
    diff/              -- DiffView, DiffLine, PeekPanel, WholeFileView
    document/          -- DocumentView (markdown with block-level comments)
    comments/          -- CommentRow, CommentTextarea, ReplyTextarea
    sidebar/           -- FileList (flat/grouped/phased), FileSearch
    header/            -- Header with repo info and branch name
    tabs/              -- TabBar, FilePicker
    commits/           -- CommitPanel (multi-commit selection)
    overview/          -- OverviewBanner (analysis summary)

skills/lgtm/           -- /lgtm skill (review workflow)
skills/analyze/        -- /lgtm analyze skill (analysis pipeline)
agents/file-classifier/ -- classifies files by priority/phase/category
agents/synthesizer/    -- synthesizes per-file analysis into overview
commands/lgtm.md       -- /lgtm slash command
hooks/                 -- SessionStart hook to auto-start server
```

## Features

**Diff review** - syntax-highlighted unified diffs with word-level change highlighting, context expansion, whole-file view toggle, and commit picker. Click any line to comment. Cmd+click identifiers to peek at their definitions.

**Document review** - rendered markdown with per-block commenting. Claude can add design docs, specs, or any text as review tabs.

**Inline comments** - threaded comments with replies. Claude's comments are visually distinct. Reply, resolve, or dismiss inline. All interactions included in the submitted review output.

**Analysis** - file priorities, review phases, thematic groupings, and a review strategy overview. The sidebar switches between flat, grouped and phased views.

**Real-time updates** - SSE pushes comment and item changes to the browser as they happen. No manual refresh needed.

**Persistence** - sessions stored in SQLite. Comment history, file review state, and analysis data survive restarts.

## How it compares

There are a lot of AI code review tools. Most of them solve a different problem than LGTM does.

**PR comment bots** (CodeRabbit, Qodo/PR-Agent, GitHub Copilot Code Review, Cursor BugBot, Greptile, Sourcery, etc.) auto-review pull requests and post comments. The feedback flows one direction - AI comments on your code, you accept or dismiss. Some support replying to the bot in PR comments, but none feed structured feedback back to an agent in a live coding session. They're useful, but they're reviewing *after* the work is done, not *during* it.

**AI coding agents** (Cursor, Cline, Aider, Windsurf) have approval workflows, but they're pre-execution gates - "should I make this change?" - not post-execution review. You approve or reject individual diffs in the IDE. There's no way to look at everything the agent did, leave inline comments across files, prioritize what matters, and send it all back as structured feedback.

**[Diffity](https://github.com/kamranahmedse/diffity)** is the closest thing to LGTM. It's an open-source browser-based diff viewer for reviewing AI agent work locally. You leave inline comments with severity tags, then run a command to have your agent resolve them. The main differences: Diffity is agent-agnostic (no MCP integration with the agent session), the human initiates review (vs LGTM where Claude seeds comments first), and there's no file prioritization or analysis layer.

LGTM's specific niche is the iterative loop: Claude posts inline comments on the diff before you even start reading, you review and respond in the browser, Claude reads your structured feedback and acts on it in the same session, you refresh and go again. The file analysis layer (priority ranking, review phases, thematic groupings) helps you focus on what matters in large diffs. As far as I can tell, nothing else combines a browser review UI, bidirectional feedback with a live agent session, and file prioritization.

## Development

```bash
npm run dev:all      # hot-reload server + HMR frontend, pointed at this repo
npm run lint         # eslint for server/ and frontend/
npm run build        # compile server + build frontend
npm test             # run all tests
```

`npm run dev:all` uses `concurrently` to run `tsx --watch` (server, auto-restarts on changes) and Vite (frontend HMR) in parallel.

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
