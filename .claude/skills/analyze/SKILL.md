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

Spawn the `file-analyzer` agent. Pass the repo path and base branch so it can use git directly.

To find the base branch, check `review_status` — the session's repo path tells you which repo,
and you can get the base branch by running `git merge-base --fork-point main HEAD` or checking
the branch the session was started against. If unclear, use `main` as the default.

```
Prompt for the agent:

Analyze the diff for the repository at <REPO_PATH>.
The base branch is <BASE_BRANCH>.
Use git commands to explore the diff and classify every file.
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
