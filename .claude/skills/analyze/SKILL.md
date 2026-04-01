---
name: analyze
description: >
  Generate analysis for an LGTM review session — classifies every file by priority,
  phase, summary, and category, then produces an overview, review strategy, and
  thematic groupings. Use when the user asks to analyze a branch for review, or
  when code is mostly done and a review session is active.
allowed-tools: "mcp__lgtm__set_analysis,mcp__lgtm__status,Agent,Bash(git:*)"
---

# Analyze Skill

Generate structured analysis for an active LGTM review session. This runs a
three-step pipeline using sub-agents that write markdown files, then an MCP tool
parses and submits the analysis.

## Prerequisites

An LGTM review session must be active for the repo. Check with `status`
if unsure. If no session exists, tell the user to start one first (or start one
yourself with the review skill).

## Pipeline

### Step 1: File analysis

Spawn the `file-analyzer` agent. Pass the repo path, base branch, and output file path.

To find the base branch, run `git rev-parse --abbrev-ref HEAD` to get the current branch,
then use `main` as the base (or `master` if main doesn't exist).

```
Prompt for the agent:

Analyze the diff for the repository at <REPO_PATH>.
The base branch is <BASE_BRANCH>.
Use git commands to explore the diff and classify every file.
Write your analysis to /tmp/lgtm-analysis-files.md
```

The agent writes a markdown file with per-file classifications.

### Step 2: Synthesis

Spawn the `synthesis` agent. Pass the path to the file analysis output, the session
description, and an output file path.

```
Prompt for the agent:

Read the file analysis at /tmp/lgtm-analysis-files.md.
Session description: <DESCRIPTION or "No description provided.">
Write your synthesis to /tmp/lgtm-analysis-synthesis.md
```

The agent reads the file analysis, then writes a markdown file with overview, strategy, and groups.

### Step 3: Submit

Call `set_analysis` with:
- `repoPath`: the repo path
- `fileAnalysisPath`: `/tmp/lgtm-analysis-files.md`
- `synthesisPath`: `/tmp/lgtm-analysis-synthesis.md`

The MCP tool parses both markdown files, merges them into the analysis JSON, validates
the structure, and sets it on the session.

If the tool returns an error, read the relevant markdown file to diagnose the parse
failure, then ask the agent to fix its output and retry.

Tell the user the analysis has been submitted and report the file count and group count
from the tool's response.
