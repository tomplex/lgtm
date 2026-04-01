# LGTM Plugin Conversion Design

## Goal

Convert the LGTM codebase into a proper Claude Code plugin with a dev workflow that supports rapid iteration. Editing a skill or agent in this repo should take effect immediately in other Claude sessions — no build step, no ceremony.

## Background

LGTM is a web-based code review UI that runs as a local HTTP server. It serves a diff/document viewer with inline commenting, exposes MCP tools for Claude to interact with reviews programmatically, and includes an analysis pipeline (agents that classify files and generate review strategy).

Currently the project has plugin-relevant assets scattered across `.claude/` (skills, agents) and a stale `claude-review@local` plugin in the cache that references a deprecated Python server. The repo needs to be restructured so that it *is* the plugin, and the plugin cache entry is a symlink to the repo.

## Expected Workflow

1. **Register** — User starts a Claude session. A hook ensures the LGTM server is running on port 9900. User says `/lgtm` or asks Claude to register the project. Claude calls `review_start` MCP tool.
2. **Work** — Claude codes. User watches diffs arrive in the browser in real time.
3. **Analyze** — When work is mostly done, user asks for detailed analysis. Claude invokes the `analyze` skill, which dispatches file-classifier and synthesizer agents. Results populate the review UI with priority, phases, and thematic groups.
4. **Review** — User reviews with analysis guidance, submits feedback. Claude reads feedback via `review_read_feedback` MCP tool. Iterate until approved.

## Repo Structure (Approach A: Plugin-at-Root)

The repo root becomes the plugin root. Plugin assets (skills, agents, commands, hooks) live alongside app source (server, frontend). The plugin cache entry is a symlink to the repo.

```
claude-review/
  .claude-plugin/
    plugin.json                  # Plugin manifest (name: lgtm, version, etc.)
  .mcp.json                     # MCP config: lgtm server at localhost:9900/mcp
  skills/
    lgtm/SKILL.md               # Main knowledge doc: workflow, MCP tools, when to use what
    analyze/SKILL.md             # Analysis pipeline orchestrator (moved from .claude/skills/)
  agents/
    file-classifier/AGENT.md    # Per-file classification (moved + renamed from .claude/agents/file-analyzer/)
    synthesizer/AGENT.md        # Overview + strategy + groups (moved + renamed from .claude/agents/synthesis/)
  commands/
    lgtm.md                     # /lgtm command: register current project with server
  hooks/
    hooks.json                  # Hook config: ensure-server on session start
    ensure-server.sh            # Starts LGTM server if not already running on 9900
  server/                       # (existing) TypeScript Express backend
  frontend/                     # (existing) Vite + vanilla TypeScript frontend
  dist/                         # (existing) Build output
  docs/                         # (existing) Specs, plans, research
  .claude/
    settings.local.json         # (stays) Local dev permissions
```

## Components

### plugin.json

```json
{
  "name": "lgtm",
  "description": "Web-based code review UI with AI-powered analysis for collaborative code review sessions",
  "version": "0.2.0",
  "author": { "name": "Tom" },
  "keywords": ["review", "diff", "mcp", "analysis"]
}
```

Version bumped from 0.1.0 (stale plugin) to 0.2.0 to reflect the rewrite.

### .mcp.json

```json
{
  "mcpServers": {
    "lgtm": {
      "url": "http://localhost:9900/mcp"
    }
  }
}
```

Static URL. The server is always running on 9900 (ensured by hook).

### Hook: ensure-server

**hooks/hooks.json:**
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/ensure-server.sh"
          }
        ]
      }
    ]
  }
}
```

**hooks/ensure-server.sh:**
```bash
#!/usr/bin/env bash
lsof -ti:9900 >/dev/null 2>&1 && exit 0
node "${CLAUDE_PLUGIN_ROOT}/dist/server/server.js" --port 9900 &
```

If anything is already listening on 9900 (dev server, prior instance), it's a no-op. During dev, `npm run dev:all` occupies the port and the hook does nothing.

### Command: /lgtm

User-facing shortcut to register the current project with the LGTM server. Accepts an optional description argument (e.g., `/lgtm adding auth middleware`). Under the hood, Claude calls the `review_start` MCP tool with the repo path and description, then tells the user the browser URL.

### Skill: lgtm

The main knowledge document. Describes:
- What LGTM is and the four workflow phases (register, work, analyze, review)
- That the server is always running on port 9900
- Available MCP tools and when to use each
- How to register a project (`review_start`)
- How to read and act on user feedback (`review_read_feedback`)
- That `/lgtm` command exists for quick registration
- When to proactively suggest analysis vs wait to be asked

Trigger description: "Use when the user asks to register a project for review, start a code review, open LGTM, analyze changes, or mentions LGTM. Also use when you want to offer the user a review of completed work."

### Skill: analyze

Moved from `.claude/skills/analyze/SKILL.md`. No logic changes. Orchestrates:
1. Spawn `file-classifier` agent to classify all changed files
2. Spawn `synthesizer` agent to create overview, strategy, and groups
3. Call `review_set_analysis_from_files` MCP tool to submit results

### Agent: file-classifier

Moved and renamed from `.claude/agents/file-analyzer/AGENT.md`. Reads the diff, classifies each file into priority (critical/important/minor/trivial), phase (review/skim/rubber-stamp), category, and one-line summary.

### Agent: synthesizer

Moved and renamed from `.claude/agents/synthesis/AGENT.md`. Takes per-file classification, produces overview, review strategy, and thematic groups.

## Dev Workflow

### Setup (one-time)

1. Remove the stale `claude-review@local` plugin entry
2. Build the project: `npm run build`
3. Symlink the plugin cache to the repo:
   ```
   ln -s /Users/tom/dev/claude-review ~/.claude/plugins/cache/local/lgtm/0.2.0
   ```
4. Update `installed_plugins.json` to register `lgtm@local` pointing at the symlink

### Day-to-day development

- Run `npm run dev:all` — starts dev server with hot reload on port 9900
- Edit skills, agents, commands — changes are live immediately in all Claude sessions (they read from the symlinked files)
- Edit server/frontend TypeScript — dev server auto-rebuilds and restarts
- No deploy step, no copy, no ceremony

### Propagation speed by change type

| Change type | Propagation | Notes |
|---|---|---|
| Skill content | Instant | Claude reads the file each time the skill is invoked |
| Agent content | Instant | Same — read fresh each invocation |
| Command content | Instant | Same |
| Hook script | Next session | Hooks are read at session start |
| Server TypeScript | ~seconds | Dev server auto-restarts via watch mode |
| Frontend TypeScript | ~seconds | Vite HMR in dev mode |
| plugin.json | Next `claude plugin` operation | Cached by Claude Code |

## Migration Steps

1. Create `.claude-plugin/plugin.json`
2. Update `.mcp.json` to use URL-based config
3. Move skills from `.claude/skills/` to `skills/`
4. Move agents from `.claude/agents/` to `agents/`, rename to file-classifier and synthesizer
5. Create `commands/lgtm.md`
6. Create `hooks/hooks.json` and `hooks/ensure-server.sh`
7. Write `skills/lgtm/SKILL.md` (new — the main workflow knowledge doc)
8. Update the `analyze` skill to reference new agent names
9. Remove stale `claude-review@local` plugin from cache and `installed_plugins.json`
10. Symlink plugin cache entry to repo
11. Register `lgtm@local` in `installed_plugins.json`
12. Delete `.claude/skills/` and `.claude/agents/` (now at repo root)
13. Update `.claude/settings.local.json` to reflect new skill/command names

## Out of Scope

- Channel notifications (push feedback to Claude) — separate initiative
- Distribution to other users — local-only for now
- Marketplace publishing
- Auto-update mechanism
