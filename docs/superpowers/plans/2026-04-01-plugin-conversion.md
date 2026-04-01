# LGTM Plugin Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the LGTM repo to be a proper Claude Code plugin with zero-friction dev workflow via symlink.

**Architecture:** Plugin-at-root approach. Plugin metadata (`.claude-plugin/plugin.json`), skills, agents, commands, and hooks live at the repo root alongside existing `server/` and `frontend/` dirs. The installed plugin is a symlink to the repo, so edits to skills/agents/commands take effect instantly in all Claude sessions.

**Tech Stack:** Claude Code plugin system, bash hooks, existing TypeScript/Express server

---

### Task 1: Create plugin manifest

**Files:**
- Create: `.claude-plugin/plugin.json`

- [ ] **Step 1: Create the plugin manifest**

```json
{
  "name": "lgtm",
  "description": "Web-based code review UI with AI-powered analysis for collaborative code review sessions",
  "version": "0.2.0",
  "author": { "name": "Tom" },
  "keywords": ["review", "diff", "mcp", "analysis"]
}
```

- [ ] **Step 2: Update .mcp.json**

The existing `.mcp.json` already has the right content. Verify it contains:

```json
{
  "mcpServers": {
    "lgtm": {
      "type": "http",
      "url": "http://localhost:9900/mcp"
    }
  }
}
```

No change needed — it already uses HTTP transport on port 9900.

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "add plugin manifest for lgtm"
```

---

### Task 2: Move agents to repo root with new names

**Files:**
- Create: `agents/file-classifier/AGENT.md` (moved + renamed from `.claude/agents/file-analyzer/AGENT.md`)
- Create: `agents/synthesizer/AGENT.md` (moved + renamed from `.claude/agents/synthesis/AGENT.md`)
- Delete: `.claude/agents/file-analyzer/AGENT.md`
- Delete: `.claude/agents/synthesis/AGENT.md`

- [ ] **Step 1: Create agents directory and move file-classifier agent**

Copy `.claude/agents/file-analyzer/AGENT.md` to `agents/file-classifier/AGENT.md`. Update the frontmatter `name` field from `file-analyzer` to `file-classifier`. The rest of the content stays the same.

Updated frontmatter:
```yaml
---
name: file-classifier
description: Analyze a code diff and classify every file by priority, phase, summary, and category. Use when generating LGTM analysis for a review session.
model: sonnet
allowed-tools: "Bash(git:*),Read,Write"
---
```

- [ ] **Step 2: Move synthesizer agent**

Copy `.claude/agents/synthesis/AGENT.md` to `agents/synthesizer/AGENT.md`. Update the frontmatter `name` field from `synthesis` to `synthesizer`. The rest of the content stays the same.

Updated frontmatter:
```yaml
---
name: synthesizer
description: Synthesize per-file analysis into an overview, review strategy, and thematic file groupings. Use after file-classifier has produced per-file classifications.
model: sonnet
allowed-tools: "Read,Write"
---
```

- [ ] **Step 3: Delete old agent locations**

```bash
rm -rf .claude/agents
```

- [ ] **Step 4: Commit**

```bash
git add agents/ .claude/agents
git commit -m "move agents to repo root, rename to file-classifier and synthesizer"
```

---

### Task 3: Move and update analyze skill

**Files:**
- Create: `skills/analyze/SKILL.md` (moved from `.claude/skills/analyze/SKILL.md`)
- Delete: `.claude/skills/analyze/SKILL.md`

- [ ] **Step 1: Move analyze skill to repo root**

Copy `.claude/skills/analyze/SKILL.md` to `skills/analyze/SKILL.md`. Update the agent references in the content:

- Change `file-analyzer` agent references to `file-classifier`
- Change `synthesis` agent references to `synthesizer`
- Change `set_analysis` MCP tool references to `mcp__lgtm__set_analysis` (the full qualified name isn't needed in the skill — the short `set_analysis` name is fine since the MCP server is `lgtm`)

Updated skill content — the pipeline section should reference the new agent names:

```markdown
### Step 1: File analysis

Spawn the `file-classifier` agent. Pass the repo path, base branch, and output file path.
```

```markdown
### Step 2: Synthesis

Spawn the `synthesizer` agent. Pass the path to the file analysis output, the session
description, and an output file path.
```

Everything else stays the same.

- [ ] **Step 2: Delete old skill location**

```bash
rm -rf .claude/skills
```

- [ ] **Step 3: Commit**

```bash
git add skills/analyze/ .claude/skills
git commit -m "move analyze skill to repo root, update agent references"
```

---

### Task 4: Create the lgtm skill (main knowledge doc)

**Files:**
- Create: `skills/lgtm/SKILL.md`

- [ ] **Step 1: Write the lgtm skill**

This is the main knowledge doc that teaches Claude how LGTM works. Create `skills/lgtm/SKILL.md`:

```markdown
---
name: lgtm
description: >
  Use when the user asks to register a project for review, start a code review,
  open LGTM, analyze changes, or mentions LGTM. Also use when you want to offer
  the user a review of completed work.
allowed-tools: "mcp__lgtm__start,mcp__lgtm__status,mcp__lgtm__add_document,mcp__lgtm__comment,mcp__lgtm__read_feedback,mcp__lgtm__stop,Skill(lgtm:analyze)"
---

# LGTM

LGTM is a web-based code review UI running at http://localhost:9900. It serves a diff
viewer with inline commenting, document review tabs, and AI-powered analysis. The server
is always running — you don't need to start it.

## Workflow

### 1. Register the project

Call the `start` MCP tool with the repo path. This registers the project with the
server and returns the browser URL. The user can optionally provide a description
(shown as a banner in the UI).

If the project is already registered, `start` is idempotent — it returns the existing
session info.

### 2. Work phase

While you're working on code, the user can watch diffs arrive in the browser in real
time. You don't need to do anything special — the UI polls for changes automatically.

You can add documents for review alongside the diff using the `add_document` tool.
This is useful for specs, design docs, or any markdown file the user should review.

You can also seed comments on the diff or documents using the `comment` tool. Use
this to flag things you want the reviewer to pay attention to, or to explain non-obvious
decisions.

### 3. Analysis phase

When the user asks for analysis (or when work is mostly done and you think analysis
would help), invoke the `lgtm:analyze` skill. This dispatches agents to classify every
file and produce a review strategy.

Don't run analysis proactively — wait for the user to ask, or suggest it when
appropriate ("Want me to run analysis to help guide the review?").

### 4. Review phase

The user reviews in the browser and clicks "Submit Review" to send feedback. Read
their feedback with the `read_feedback` tool. Address each comment, then let the user
know you've responded. They can submit multiple rounds.

Check `status` to see if feedback has been submitted and how many rounds have occurred.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `start` | Register a project — returns the browser URL |
| `status` | List registered projects and feedback status |
| `add_document` | Add a document tab (spec, design doc, markdown file) |
| `comment` | Seed inline comments on a diff or document |
| `read_feedback` | Read submitted review feedback |
| `stop` | Deregister a project |
| `set_analysis` | Submit analysis data (called by the analyze skill, not directly) |

## The /lgtm command

Users can type `/lgtm` to quickly register the current project. This is equivalent to
calling `start` with the repo path.
```

- [ ] **Step 2: Commit**

```bash
git add skills/lgtm/
git commit -m "add lgtm skill - main workflow knowledge doc"
```

---

### Task 5: Create the /lgtm command

**Files:**
- Create: `commands/lgtm.md`

- [ ] **Step 1: Write the command**

Create `commands/lgtm.md`:

```markdown
---
name: lgtm
description: Register the current project with LGTM for code review
arguments:
  - name: description
    description: "Optional: review context shown as a banner in the UI"
    required: false
allowed-tools: "mcp__lgtm__start"
---

# /lgtm command

Register the current project with the LGTM review server.

1. Get the repo root: `git rev-parse --show-toplevel`
2. Call the `start` MCP tool with:
   - `repoPath`: the repo root
   - `description`: `$ARGUMENTS` (if provided)
3. Tell the user the review URL from the response.
```

- [ ] **Step 2: Commit**

```bash
git add commands/lgtm.md
git commit -m "add /lgtm command for quick project registration"
```

---

### Task 6: Create the session-start hook

**Files:**
- Create: `hooks/hooks.json`
- Create: `hooks/ensure-server.sh`

- [ ] **Step 1: Write hooks.json**

Create `hooks/hooks.json`:

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

- [ ] **Step 2: Write the ensure-server script**

Create `hooks/ensure-server.sh`:

```bash
#!/usr/bin/env bash
# Start the LGTM server if nothing is listening on port 9900.
# During development, npm run dev:all occupies the port — this is a no-op.
lsof -ti:9900 >/dev/null 2>&1 && exit 0
nohup node "${CLAUDE_PLUGIN_ROOT}/dist/server/server.js" --port 9900 >/dev/null 2>&1 &
```

- [ ] **Step 3: Make the script executable**

```bash
chmod +x hooks/ensure-server.sh
```

- [ ] **Step 4: Commit**

```bash
git add hooks/
git commit -m "add session-start hook to ensure LGTM server is running"
```

---

### Task 7: Update settings.local.json

**Files:**
- Modify: `.claude/settings.local.json`

- [ ] **Step 1: Update permission references**

The current `settings.local.json` has stale permission references (old `review_*` MCP tool names, old skill names). Update it to reflect the new plugin structure.

The key changes:
- Remove `Skill(claude-review:review)` — the old plugin skill
- Remove `Skill(analyze)` — now namespaced as `lgtm:analyze`
- Add `Skill(lgtm:analyze)` and `Skill(lgtm:lgtm)`
- Remove stale `mcp__lgtm__review_*` references — the tools are now `mcp__lgtm__start`, `mcp__lgtm__status`, etc. (they've already been renamed on the server side)
- Keep all the bash, build tool, and other permissions as-is

Replace the MCP tool permissions with:
```json
"mcp__lgtm__start",
"mcp__lgtm__status",
"mcp__lgtm__comment",
"mcp__lgtm__add_document",
"mcp__lgtm__read_feedback",
"mcp__lgtm__set_analysis",
"mcp__lgtm__stop"
```

Replace the skill permissions with:
```json
"Skill(lgtm:analyze)",
"Skill(lgtm:lgtm)"
```

- [ ] **Step 2: Commit**

```bash
git add .claude/settings.local.json
git commit -m "update settings.local.json for new plugin structure"
```

---

### Task 8: Remove stale plugin and install via symlink

This task sets up the dev workflow. It modifies files outside the repo (in `~/.claude/plugins/`).

- [ ] **Step 1: Remove the stale claude-review plugin from the cache**

```bash
rm -rf ~/.claude/plugins/cache/local/claude-review
```

- [ ] **Step 2: Create the symlink for the lgtm plugin**

```bash
mkdir -p ~/.claude/plugins/cache/local/lgtm/0.2.0
rm -rf ~/.claude/plugins/cache/local/lgtm/0.2.0
ln -s /Users/tom/dev/claude-review ~/.claude/plugins/cache/local/lgtm/0.2.0
```

- [ ] **Step 3: Update installed_plugins.json**

Edit `~/.claude/plugins/installed_plugins.json`:
- Remove the `"claude-review@local"` entry
- Add a new `"lgtm@local"` entry:

```json
"lgtm@local": [
  {
    "scope": "user",
    "installPath": "/Users/tom/.claude/plugins/cache/local/lgtm/0.2.0",
    "version": "0.2.0",
    "installedAt": "2026-04-01T00:00:00.000Z",
    "lastUpdated": "2026-04-01T00:00:00.000Z"
  }
]
```

- [ ] **Step 4: Verify the symlink works**

```bash
ls -la ~/.claude/plugins/cache/local/lgtm/0.2.0/.claude-plugin/plugin.json
cat ~/.claude/plugins/cache/local/lgtm/0.2.0/.claude-plugin/plugin.json
```

Expected: shows the plugin.json content from the repo.

- [ ] **Step 5: No commit needed** — these changes are outside the repo.

---

### Task 9: Verify end-to-end

- [ ] **Step 1: Check plugin structure is correct**

```bash
ls -la /Users/tom/dev/claude-review/.claude-plugin/
ls -la /Users/tom/dev/claude-review/skills/
ls -la /Users/tom/dev/claude-review/agents/
ls -la /Users/tom/dev/claude-review/commands/
ls -la /Users/tom/dev/claude-review/hooks/
```

Expected: all plugin directories exist with their files.

- [ ] **Step 2: Verify old .claude/ dirs are cleaned up**

```bash
ls /Users/tom/dev/claude-review/.claude/
```

Expected: only `settings.local.json` remains (no `skills/` or `agents/` subdirectories).

- [ ] **Step 3: Verify MCP server is accessible**

```bash
curl -s http://localhost:9900/mcp -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}},"id":1}'
```

Expected: JSON response with server capabilities.

- [ ] **Step 4: Verify the symlink resolves correctly**

```bash
readlink ~/.claude/plugins/cache/local/lgtm/0.2.0
```

Expected: `/Users/tom/dev/claude-review`

- [ ] **Step 5: Make a final commit with any cleanup**

```bash
git add -A
git status
# If there are changes, commit them
git commit -m "plugin conversion complete"
```
