---
name: analyze
description: >
  Generate analysis for an LGTM review session — classifies every file by priority,
  phase, summary, and category, then produces an overview, review strategy, and
  thematic groupings. Use when the user asks to analyze a branch for review, or
  when code is mostly done and a review session is active.
allowed-tools: "mcp__lgtm__set_analysis,mcp__lgtm__start,mcp__plugin_lgtm_lgtm__set_analysis,mcp__plugin_lgtm_lgtm__start,Agent,Bash(git:*)"
---

# Analyze Skill

Generate structured analysis for an active LGTM review session. This runs a
three-step pipeline using sub-agents that write markdown files, then an MCP tool
parses and submits the analysis.

## Prerequisites

An LGTM review session must be active for the repo. If no session exists,
start one with `start` (calling it again for an existing session is safe —
it returns the existing URL).

## Pipeline

### Step 1: File analysis

Spawn the `file-classifier` agent. Pass the repo path, base branch, and output file path.

To find the base branch:

1. First try `gh pr view --json baseRefName -q .baseRefName` to get the PR's actual base branch.
   If that succeeds, fetch it with `git fetch origin <branch>` and use `origin/<branch>` as the base.
2. Only fall back to `main` (or `master` if main doesn't exist) when there's no open PR.

This matters for stacked PRs that target a parent branch instead of main.

```
Prompt for the agent:

Analyze the diff for the repository at <REPO_PATH>.
The base branch is <BASE_BRANCH>.
Use git commands to explore the diff and classify every file.
Write your analysis to /tmp/lgtm-analysis-files.md
```

The agent writes a markdown file with per-file classifications.

### Step 2: Synthesis

Spawn the `synthesizer` agent. Pass the path to the file analysis output, the session
description, and both output file paths.

```
Prompt for the agent:

Read the file analysis at /tmp/lgtm-analysis-files.md.
Session description: <DESCRIPTION or "No description provided.">
Write your synthesis to /tmp/lgtm-analysis-synthesis.md
Write your review guide to /tmp/lgtm-analysis-review-guide.md
```

The agent reads the file analysis, then writes two files: a structured synthesis (groups)
and a human-readable review guide (overview, strategy, opinion).

### Step 3: Submit

Call `set_analysis` with:
- `repoPath`: the repo path
- `fileAnalysisPath`: `/tmp/lgtm-analysis-files.md`
- `synthesisPath`: `/tmp/lgtm-analysis-synthesis.md`
- `reviewGuidePath`: `/tmp/lgtm-analysis-review-guide.md`

The MCP tool parses both markdown files, merges them into the analysis JSON, validates
the structure, and sets it on the session.

If the tool returns an error, read the relevant markdown file to diagnose the parse
failure, then ask the agent to fix its output and retry.

Tell the user the analysis has been submitted and report the file count and group count
from the tool's response.
