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
- **`/lgtm walkthrough` skill** - generates a narrated tour of the diff as ordered "stops" you step through in the UI
- **`/lgtm prepare` skill** - chains analyze + walkthrough so a review session opens fully primed
- **MCP tools** - Claude can claim reviews, post comments, add documents, set analysis and walkthroughs, read your feedback
- **SessionStart hook** - auto-starts the LGTM server on port 9900 if it isn't already running
- **Sub-agents** - file-classifier, synthesizer, and walkthrough-author agents power the analysis and walkthrough pipelines

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

<!-- screenshot: analysis sidebar in phased view, showing review/skim/rubber-stamp groups -->

### Walkthrough

For larger or more architectural changes, Claude can generate a *narrated walkthrough* — an ordered sequence of "stops" through the diff, each with a title, narrative, and references to the specific lines and files it covers. You step through it in the UI like a guided tour. Stops are tracked as visited, the sidebar shows stop-coverage badges per file, and you can still leave comments and use peek-definition while inside walkthrough mode.

Press `W` from the diff to enter walkthrough mode. `Enter` and `Shift+Enter` step forward and back; `g` followed by a digit jumps directly to a stop; `d` exits back to the diff.

<!-- screenshot: walkthrough view with active stop, narrative, and the referenced diff lines below -->

## Features

### Diff review

Syntax-highlighted unified diffs with word-level change detection — added and removed words light up inside changed lines, so you see *what* changed, not just *that* something changed. Click any line number to comment. Expand context above or below any hunk. Toggle whole-file view (`w`) to see the change in surrounding context.

For multi-commit branches, open the commit picker (`c`) and select any subset of commits to scope the diff. Useful when a branch has setup commits you want to skim and a single commit with the real change you want to focus on.

### Peek definition, hover docs, and references

Cmd+click any identifier in the diff to peek at its definition without leaving the review. For Python, TypeScript / JavaScript, and Rust, peek is backed by real language servers (`pyright`, `typescript-language-server`, `rust-analyzer`) — so you get accurate definitions, hover documentation rendered as markdown, and a list of references in a collapsible section. The plugin offers to install missing language servers from the header on first use.

For other languages (and for top-level Go decls), peek falls back to ripgrep heuristics — fast, no setup, works across the whole repo. Double-tap `Shift` to open symbol search and jump to any symbol by name.

<!-- screenshot: peek panel open over a diff line, showing definition + hover docs + collapsible references -->

### Document review

Claude can attach markdown docs — design specs, planning notes, ADRs, anything textual — as separate review tabs alongside the diff. Markdown renders with proper formatting; you can leave block-level comments on any paragraph, code block, or heading. Useful when the design context lives outside the diff itself.

<!-- screenshot: document tab with rendered markdown and a block-level comment -->

### Inline comments and threads

Threaded comments with replies. Claude's comments are visually distinct from yours, so you can tell at a glance who said what. Reply, resolve, or dismiss inline. Every comment, reply, and resolution is included in the structured review output Claude reads when you submit.

Jump between comments with `n` / `p`. Save with `Cmd+Enter`, cancel with `Esc`.

<!-- screenshot: a comment thread with a reply, showing Claude's seeded comment vs user reply styling -->

### Analysis-driven prioritization

For larger diffs, Claude can run an analysis pass that classifies every file by priority (critical / important / normal / low) and review phase (review / skim / rubber-stamp), groups files thematically, and writes a review strategy overview. The sidebar switches between flat, grouped, and phased views, so you can work through a 40-file branch in priority order rather than alphabetically.

### Real-time updates

Server-sent events push comment and item changes to the browser as they happen. When Claude posts a new comment, attaches a document, or updates analysis, the UI updates without a refresh. Same the other way: when you submit a review, Claude sees it immediately (with the development channels flag enabled).

### Persistence

Sessions live in a SQLite database at `~/.lgtm/data.db`. Comment history, file review state, analysis data, and document attachments survive server restarts and Claude session changes. Open the same project later and pick up where you left off.

### Multi-project and command palette

Multiple projects can be registered at once, each scoped under its own URL path (`/project/:slug/`). `Cmd+K` opens a project palette to switch between repositories without restarting the server or losing your place.

### Keyboard-driven

Navigate files with `j`/`k` or arrows. Move into and out of folders with `h`/`l`, jump folder-to-folder with `[`/`]`, collapse with `o`. Mark files reviewed with `e`. Search files with `f`. Double-tap `Shift` for symbol search. Refresh with `r`. Full shortcut list at the bottom of this README.

## MCP tools

| Tool | What it does |
|------|-------------|
| `claim_reviews` | Auto-registers the project (if needed), claims review-feedback notifications for the calling Claude session, and returns the browser URL. The primary entry point. |
| `add_document` | Attach a markdown/text doc as a review tab. Auto-registers the project. |
| `comment` | Post inline comments on the diff or a document. |
| `reply` | Reply to a specific user comment. |
| `set_analysis` | Set file priorities, review strategy, and thematic groupings (called by the analyze skill). |
| `set_walkthrough` | Set the narrated walkthrough for a session (called by the walkthrough skill). |
| `read_feedback` | Read the user's submitted review as structured markdown. |
| `stop` | Deregister a project session. |

## How it compares

There are a lot of AI code review tools. Most of them solve a different problem than LGTM does.

**PR comment bots** (CodeRabbit, Qodo/PR-Agent, GitHub Copilot Code Review, Cursor BugBot, Greptile, Sourcery, etc.) auto-review pull requests and post comments. The feedback flows one direction - AI comments on your code, you accept or dismiss. Some support replying to the bot in PR comments, but none feed structured feedback back to an agent in a live coding session. They're useful, but they're reviewing *after* the work is done, not *during* it.

**AI coding agents** (Cursor, Cline, Aider, Windsurf) have approval workflows, but they're pre-execution gates - "should I make this change?" - not post-execution review. You approve or reject individual diffs in the IDE. There's no way to look at everything the agent did, leave inline comments across files, prioritize what matters, and send it all back as structured feedback.

**[Diffity](https://github.com/kamranahmedse/diffity)** is the closest thing to LGTM. It's an open-source browser-based diff viewer for reviewing AI agent work locally. You leave inline comments with severity tags, then run a command to have your agent resolve them. The main differences: Diffity is agent-agnostic (no MCP integration with the agent session), the human initiates review (vs LGTM where Claude seeds comments first), and there's no file prioritization or analysis layer.

LGTM's specific niche is the iterative loop: Claude posts inline comments on the diff before you even start reading, you review and respond in the browser, Claude reads your structured feedback and acts on it in the same session, you refresh and go again.

The review UI itself is more full-featured than most diff viewers in this space. Syntax-highlighted diffs with word-level change detection, context expansion, whole-file view, commit picker for multi-commit branches, Cmd+click peek-definition (LSP-backed for Python / TypeScript / Rust with hover docs and references, ripgrep fallback for everything else), threaded inline comments with replies, and rendered markdown document tabs for specs or design docs that Claude can attach alongside the diff. SSE keeps everything live - comments and items update in real time as Claude works.

The analysis layer is where it gets opinionated. Claude classifies every file in the diff by priority (critical / important / normal / low) and review phase (review / skim / rubber-stamp), groups files thematically, and writes a review strategy overview. The sidebar switches between flat, grouped and phased views based on this analysis, so you can work through a large diff in order of importance rather than alphabetically. For a 40-file branch, the difference between "here are 40 files" and "here are the 6 files that matter, skim these 12, rubber-stamp the rest" is significant.

The walkthrough layer goes a step further: Claude can author a narrated tour through the diff — ordered "stops" that walk you through the logical changes in a sensible reading order, each pointing at the specific lines and files involved. Useful for big architectural changes where the diff alone doesn't tell the story.

As far as I can tell, nothing else combines a browser review UI, bidirectional feedback with a live agent session, guided review prioritization, and authored walkthroughs.

## Development

```bash
npm run dev:all      # hot-reload server + HMR frontend, pointed at this repo
npm run lint         # eslint for server/ and frontend/
npm run build        # compile server + build frontend
npm test             # run all tests
```

`npm run dev:all` uses `concurrently` to run `tsx --watch` (server, auto-restarts on changes) and Vite (frontend HMR) in parallel.

## Keyboard shortcuts

### Diff view

| Key | Action |
|-----|--------|
| `j`/`k` or `↓`/`↑` | Navigate rows in the sidebar |
| `h`/`l` or `←`/`→` | Collapse / expand folder, or move out / into |
| `[`/`]` | Jump to previous / next folder |
| `o` | Toggle the active folder collapsed |
| `f` | Focus file search |
| `e` | Toggle current file (or folder) as reviewed |
| `c` | Toggle commit picker |
| `n`/`p` | Jump to next / previous comment |
| `w` | Toggle whole-file view |
| `W` | Enter walkthrough mode (when a walkthrough is loaded) |
| `r` | Refresh |
| `Shift Shift` | Open symbol search (double-tap Shift) |
| `Cmd+K` | Open project palette |
| `?` | Open keyboard shortcut help |
| `Cmd+Enter` | Save comment |
| `Esc` | Cancel comment / close panel / clear search |

### Walkthrough mode

| Key | Action |
|-----|--------|
| `Enter` | Next stop |
| `Shift+Enter` | Previous stop |
| `g` then `1`–`9` | Jump to stop by number |
| `d` | Exit walkthrough mode |
