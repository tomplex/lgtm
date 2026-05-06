---
name: refresh
description: >
  Refresh an existing LGTM analysis incrementally — re-classify only files whose
  diff has changed since the last analysis. Use after making commits on a long-
  lived branch when you want to keep the analysis layer fresh without redoing
  the full classification pass. Falls back to a full /lgtm analyze run if no
  prior analysis exists.
allowed-tools: "mcp__lgtm__read_analysis,mcp__plugin_lgtm_lgtm__read_analysis,mcp__lgtm__set_analysis,mcp__plugin_lgtm_lgtm__set_analysis,Agent,Bash(git:*),Read,Write"
---

# Refresh Skill

Incremental update of an existing analysis. The server already persists prior
state; this skill computes the delta, re-classifies only stale files, and
re-synthesizes.

## Prerequisites

A prior analysis must exist for this project. If none does, call the `analyze`
skill instead — there's nothing to refresh from a blank slate.

## Pipeline

### Step 1: Read prior analysis

Call `read_analysis` with the repo path. The response contains:

- `json` — the full prior analysis (or `null` if none).
- `markdown` — file-classifier-format rendering of the prior file analysis.
- `freshness` — `{staleFiles, missingFiles, removedFiles, staleSynthesis, computedAtHead, computedAtBase}`.

If `json` is null, invoke the `analyze` skill instead — there's nothing to
refresh.

If `freshness.staleFiles`, `missingFiles`, and `removedFiles` are all empty,
report "analysis is fresh, nothing to do" and exit.

### Step 2: Write prior markdown to scratch

Write the `markdown` field from `read_analysis` to
`/tmp/lgtm-analysis-files-prev.md`. This becomes the agent's prior-context
input.

### Step 3: Spawn file-classifier in delta mode

Spawn the `file-classifier` agent with a prompt of the form:

```
Refresh analysis for the repository at <REPO_PATH>.
The base branch is <BASE_BRANCH>.

Previous analysis (for category/style continuity):
/tmp/lgtm-analysis-files-prev.md

Re-classify ONLY these files (diffs have changed since last analysis):
- <each path from staleFiles ∪ missingFiles, one per line>

Read the agent's documented "Delta mode" section in its instructions: it should
output ONLY entries for the listed files to /tmp/lgtm-analysis-files.md. Do NOT
copy unchanged entries from the previous analysis — the server merges them in.
```

Find the base branch the same way the `analyze` skill does:
1. Try `gh pr view --json baseRefName -q .baseRefName`. If it succeeds, fetch
   with `git fetch origin <branch>` and use `origin/<branch>`.
2. Fall back to `main` (or `master`) if there's no open PR.

### Step 4: Compose merged file analysis

Locally compose the merged file analysis (previous entries minus
`removedFiles`, overlaid with the new entries the agent wrote) and save to
`/tmp/lgtm-analysis-files-merged.md`. This is the input to the synthesizer.

A simple recipe: take `/tmp/lgtm-analysis-files-prev.md`, drop any `## <path>`
block where `<path>` appears in `removedFiles ∪ staleFiles ∪ missingFiles`,
then append the entire content of `/tmp/lgtm-analysis-files.md`.

(You can do this with `Read` + string slicing in a small bash command, or read
both files via the Read tool and paste them together with the `Write` tool.)

### Step 5: Spawn synthesizer

Same as in `/lgtm analyze`:

```
Read the file analysis at /tmp/lgtm-analysis-files-merged.md.
Session description: <DESCRIPTION or "No description provided.">
Write your synthesis to /tmp/lgtm-analysis-synthesis.md
Write your review guide to /tmp/lgtm-analysis-review-guide.md
```

The synthesizer agent is unchanged — re-uses the existing pipeline.

### Step 6: Submit

Call `set_analysis` with:

- `repoPath`: the repo path
- `fileAnalysisPath`: `/tmp/lgtm-analysis-files.md` (the agent's delta-only
  output)
- `synthesisPath`: `/tmp/lgtm-analysis-synthesis.md`
- `reviewGuidePath`: `/tmp/lgtm-analysis-review-guide.md`
- `mode`: `"merge"`
- `removedFiles`: `freshness.removedFiles`

The server merges, stamps blob SHAs, and broadcasts `analysis_changed` so
connected browsers refresh.

## Reporting

Tell the user:
- N files re-classified (`|staleFiles ∪ missingFiles|`)
- M files dropped (`|removedFiles|`)
- Total file count after merge
- Synthesis re-run

If `set_analysis` returns an error, read the relevant markdown file to
diagnose, fix the agent's output, and retry.
