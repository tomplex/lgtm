# Analysis Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code skill that generates structured analysis JSON for LGTM review sessions using a three-step sub-agent pipeline (file analysis → synthesis → validation + submit).

**Architecture:** A new `analyze` skill in the `claude-review` plugin orchestrates two sequential sub-agents. The file analysis agent calls `review_get_diff` via MCP and classifies every file. The synthesis agent takes those classifications and produces overview, strategy, and groupings. Main Claude validates and submits via `review_set_analysis`. Two new agent definitions in the plugin provide the sub-agent prompts.

**Tech Stack:** Claude Code plugin system (skills, agents), LGTM MCP tools (`review_get_diff`, `review_set_analysis`)

---

### Task 1: Create the file analysis agent

**Files:**
- Create: `~/.claude/plugins/local/claude-review/agents/file-analyzer/AGENT.md`

This agent receives the diff payload and produces per-file classifications. It is spawned by the skill and calls MCP tools directly.

- [ ] **Step 1: Create the agent directory**

```bash
mkdir -p ~/.claude/plugins/local/claude-review/agents/file-analyzer
```

- [ ] **Step 2: Write the agent definition**

Create `~/.claude/plugins/local/claude-review/agents/file-analyzer/AGENT.md`:

```markdown
---
name: file-analyzer
description: Analyze a code diff and classify every file by priority, phase, summary, and category. Use when generating LGTM analysis for a review session.
model: sonnet
allowed-tools: "mcp__lgtm__review_get_diff"
---

# File Analysis Agent

You are analyzing a code diff to help a human reviewer triage their review. Your job is to classify every file in the diff.

## Instructions

1. Call the `mcp__lgtm__review_get_diff` tool with the `repoPath` provided in your task prompt.
2. Read the manifest (file list with change types and line stats) and the full unified diff.
3. For EVERY file in the manifest, produce a classification with these four fields:

### Priority

| Level | Criteria |
|-------|----------|
| **critical** | New core logic, security-sensitive changes, breaking API changes, complex algorithms, data migrations that could lose data |
| **important** | Significant modifications to existing logic, non-trivial bug fixes, configuration that affects behavior in production |
| **normal** | Straightforward additions, test files for critical/important code, documentation of new features |
| **low** | Mechanical changes (renames, import updates, call-site threading), auto-generated files, formatting, dependency bumps |

### Phase

| Phase | Criteria |
|-------|----------|
| **review** | Needs line-by-line reading. The reviewer should understand every decision. |
| **skim** | Worth reading through for surprises, but the reviewer doesn't need to verify every line. Typical: well-structured tests, docs, config that follows clear patterns. |
| **rubber-stamp** | Mechanical/generated. Glance to confirm it matches the pattern, move on. |

### Category

A short freeform label. Examples: "core logic", "test", "migration", "config", "call-site update", "documentation", "build/CI", "types/interfaces".

### Summary

1-2 sentences. Answer: what changed and why a reviewer should care (or not). Focus on intent and risk, not diff narration — the reviewer can read the diff themselves.

## Output format

Respond with ONLY a JSON object. No markdown fencing, no explanation. The object must be keyed by file path (matching the manifest paths exactly), with each value containing `priority`, `phase`, `summary`, and `category`:

```
{
  "src/auth.ts": {
    "priority": "critical",
    "phase": "review",
    "summary": "New authentication middleware — validates JWT tokens and attaches user context to requests",
    "category": "core logic"
  },
  "tests/auth.test.ts": {
    "priority": "normal",
    "phase": "skim",
    "summary": "Unit tests for the auth middleware, covers valid/invalid/expired token cases",
    "category": "test"
  }
}
```

Every file in the manifest MUST appear in your output. Do not invent files that are not in the manifest.
```

- [ ] **Step 3: Verify the file exists**

```bash
cat ~/.claude/plugins/local/claude-review/agents/file-analyzer/AGENT.md | head -5
```

Expected: The frontmatter starting with `---` and `name: file-analyzer`.

- [ ] **Step 4: Commit**

```bash
git -C ~/.claude/plugins/local/claude-review add agents/file-analyzer/AGENT.md
git -C ~/.claude/plugins/local/claude-review commit -m "add file-analyzer agent for diff analysis"
```

---

### Task 2: Create the synthesis agent

**Files:**
- Create: `~/.claude/plugins/local/claude-review/agents/synthesis/AGENT.md`

This agent receives per-file analysis and produces overview, review strategy, and thematic groupings. It does not need the raw diff.

- [ ] **Step 1: Create the agent directory**

```bash
mkdir -p ~/.claude/plugins/local/claude-review/agents/synthesis
```

- [ ] **Step 2: Write the agent definition**

Create `~/.claude/plugins/local/claude-review/agents/synthesis/AGENT.md`:

```markdown
---
name: synthesis
description: Synthesize per-file analysis into an overview, review strategy, and thematic file groupings. Use after file-analyzer has produced per-file classifications.
model: sonnet
---

# Synthesis Agent

You are synthesizing per-file analysis results into a high-level review guide. Your task prompt will contain:

1. **Per-file analysis JSON** — every file classified with priority, phase, summary, and category.
2. **Session description** — context about what the branch is doing (may be empty).

## Instructions

Produce three things:

### 1. Overview

1-3 sentences summarizing the PR: what it does, key design decisions, and risk areas. Write for a reviewer who understands the codebase but hasn't looked at this branch yet.

### 2. Review Strategy

A concrete suggestion for how to approach the review. Which files or groups to start with, what to pay attention to, what can be safely batch-skimmed. Reference specific files or groups by name.

### 3. Groups

Organize the files into thematic groups. Each group has:
- `name`: A descriptive display name (e.g., "Auth middleware (new)", "Call-site updates")
- `description` (optional): A subtitle clarifying the group's purpose
- `files`: An array of file paths belonging to this group

Rules:
- Order groups by review importance (most important first)
- Each file appears in at most one group
- Files that don't fit any natural group can be left ungrouped (they'll appear in an auto-generated "Other" group in the UI)
- Don't force files into groups — a small "Other" group is better than a contrived grouping
- Group by thematic coherence (files that serve the same purpose), not by directory structure

## Output format

Respond with ONLY a JSON object. No markdown fencing, no explanation:

```
{
  "overview": "This PR adds JWT-based auth middleware with role-based permissions...",
  "reviewStrategy": "Start with the 3 core auth files...",
  "groups": [
    {
      "name": "Auth middleware (new)",
      "description": "Core authentication and authorization logic",
      "files": ["src/auth/middleware.ts", "src/auth/permissions.ts"]
    },
    {
      "name": "Database migration",
      "files": ["db/migrations/024_auth.sql"]
    }
  ]
}
```
```

- [ ] **Step 3: Verify the file exists**

```bash
cat ~/.claude/plugins/local/claude-review/agents/synthesis/AGENT.md | head -5
```

Expected: The frontmatter starting with `---` and `name: synthesis`.

- [ ] **Step 4: Commit**

```bash
git -C ~/.claude/plugins/local/claude-review add agents/synthesis/AGENT.md
git -C ~/.claude/plugins/local/claude-review commit -m "add synthesis agent for review overview and groupings"
```

---

### Task 3: Create the analyze skill

**Files:**
- Create: `~/.claude/plugins/local/claude-review/skills/analyze/SKILL.md`

This is the orchestrator. It tells Claude Code how to run the three-step pipeline: spawn file analysis agent → spawn synthesis agent → validate and submit.

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p ~/.claude/plugins/local/claude-review/skills/analyze
```

- [ ] **Step 2: Write the skill definition**

Create `~/.claude/plugins/local/claude-review/skills/analyze/SKILL.md`:

```markdown
---
name: analyze
description: >
  Generate analysis for an LGTM review session — classifies every file by priority,
  phase, summary, and category, then produces an overview, review strategy, and
  thematic groupings. Use when the user asks to analyze a branch for review, or
  when code is mostly done and a review session is active.
allowed-tools: "mcp__lgtm__review_set_analysis,mcp__lgtm__review_status,Agent"
---

# Analyze Skill

Generate structured analysis for an active LGTM review session. This runs a
three-step pipeline using sub-agents.

## Prerequisites

An LGTM review session must be active for the repo. Check with `review_status`
if unsure. If no session exists, tell the user to start one first (or start one
yourself with the review skill).

## Pipeline

### Step 1: File analysis

Spawn the `file-analyzer` agent. Pass the repo path so it can call `review_get_diff`.

```
Prompt for the agent:

Analyze the diff for the repository at <REPO_PATH>.
Call review_get_diff with repoPath "<REPO_PATH>" to get the diff, then classify every file.
```

The agent returns a JSON object keyed by file path with `priority`, `phase`, `summary`, and `category` per file.

Parse the JSON from the agent's response. If the agent's response contains markdown fencing around the JSON, strip it before parsing.

### Step 2: Synthesis

Spawn the `synthesis` agent. Pass the per-file analysis from step 1 and the session description.

```
Prompt for the agent:

Here is the per-file analysis for a code review:

<FILE_ANALYSIS_JSON>

Session description: <DESCRIPTION or "No description provided.">

Produce the overview, review strategy, and file groupings.
```

The agent returns a JSON object with `overview`, `reviewStrategy`, and `groups`.

Parse the JSON from the agent's response. If the agent's response contains markdown fencing around the JSON, strip it before parsing.

### Step 3: Validate and submit

Merge the outputs into the final analysis object:

```json
{
  "overview": "<from synthesis>",
  "reviewStrategy": "<from synthesis>",
  "files": { "<from file analysis>" },
  "groups": [ "<from synthesis>" ]
}
```

Before submitting, validate:

1. **Coverage** — every file from the file analysis agent's output is present. (The file analysis agent should have covered every file in the manifest. If files are missing, add them with priority "normal", phase "skim", a generic summary, and category "unknown".)
2. **No hallucinations** — no files in `groups[].files` arrays that don't exist in the `files` object. Remove any that don't match.
3. **Valid enums** — priority is one of: `critical`, `important`, `normal`, `low`. Phase is one of: `review`, `skim`, `rubber-stamp`. Fix any invalid values.
4. **Group integrity** — no file appears in more than one group. If duplicates exist, keep only the first occurrence.
5. **Non-empty text** — `overview`, `reviewStrategy`, and every file's `summary` must be non-empty strings.
6. **Cross-axis consistency** — flag and fix these suspicious combinations:
   - `low` priority + `review` phase → change phase to `skim`
   - `critical` priority + `rubber-stamp` phase → change phase to `review`

After validation, call `review_set_analysis` with the repo path and the analysis object.

Tell the user the analysis has been submitted and give a brief summary: how many files were analyzed, how many are critical/important, and how many groups were created.
```

- [ ] **Step 3: Verify the file exists**

```bash
cat ~/.claude/plugins/local/claude-review/skills/analyze/SKILL.md | head -5
```

Expected: The frontmatter starting with `---` and `name: analyze`.

- [ ] **Step 4: Commit**

```bash
git -C ~/.claude/plugins/local/claude-review add skills/analyze/SKILL.md
git -C ~/.claude/plugins/local/claude-review commit -m "add analyze skill for three-step analysis pipeline"
```

---

### Task 4: Register agents in plugin.json

**Files:**
- Modify: `~/.claude/plugins/local/claude-review/plugin.json`

The plugin manifest needs to declare the new agents so Claude Code discovers them.

- [ ] **Step 1: Read current plugin.json**

```bash
cat ~/.claude/plugins/local/claude-review/plugin.json
```

Current content:

```json
{
  "name": "claude-review",
  "version": "0.1.0",
  "description": "Web-based code review UI for collaborating with Claude on diffs and documents"
}
```

- [ ] **Step 2: Check if plugin.json needs agent registration**

Claude Code plugins auto-discover agents from the `agents/` directory by convention. Check whether the agents are detected after reloading plugins:

```bash
# User should run: /reload-plugins
# Then check if file-analyzer and synthesis appear in the agent list
```

If agents are auto-discovered, no change to plugin.json is needed. If not, add an `agents` field:

```json
{
  "name": "claude-review",
  "version": "0.1.0",
  "description": "Web-based code review UI for collaborating with Claude on diffs and documents",
  "agents": [
    "agents/file-analyzer/AGENT.md",
    "agents/synthesis/AGENT.md"
  ]
}
```

- [ ] **Step 3: Commit if changed**

```bash
git -C ~/.claude/plugins/local/claude-review add plugin.json
git -C ~/.claude/plugins/local/claude-review commit -m "register analysis agents in plugin manifest"
```

---

### Task 5: Manual integration test

No automated tests for this — the skill orchestrates sub-agents via MCP tools, so it needs a live LGTM session. This task walks through a manual end-to-end test.

- [ ] **Step 1: Reload plugins**

The user runs `/reload-plugins` in Claude Code to pick up the new skill and agents.

- [ ] **Step 2: Start a review session**

Start a review session on a repo with some changes. The `claude-review` repo itself works if it has uncommitted or branch changes:

```
Use MCP: review_start with repoPath pointing to a repo that has branch changes
```

- [ ] **Step 3: Invoke the skill**

Tell Claude: "Analyze the diff for review" or invoke the skill however it's triggered. Claude should:
1. Spawn the file-analyzer agent (check it calls `review_get_diff`)
2. Get back per-file JSON
3. Spawn the synthesis agent with that JSON
4. Get back overview, strategy, groups
5. Validate and call `review_set_analysis`

- [ ] **Step 4: Verify in the UI**

Open the LGTM review URL in a browser. Check:
- The overview banner appears with the overview and review strategy text
- The sidebar shows priority indicators (colored left borders)
- Switching to "Grouped" view shows the thematic groups
- Switching to "Phased" view shows review/skim/rubber-stamp sections
- File summaries appear in the sidebar and diff headers

- [ ] **Step 5: Check edge cases**

Try the skill on:
- A repo with only 1-2 changed files (should still produce valid analysis)
- A repo with no active review session (should error gracefully, telling user to start one)

- [ ] **Step 6: Commit the spec update if needed**

If any changes were needed to the skill or agents during testing, commit them:

```bash
git -C ~/.claude/plugins/local/claude-review add -A
git -C ~/.claude/plugins/local/claude-review commit -m "fix analysis skill based on integration testing"
```
