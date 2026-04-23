---
name: walkthrough
description: >
  Generate a narrated walkthrough for an LGTM review session. Produces an ordered
  sequence of logical-change stops with titles, narratives, and artifact references.
  Use when the user asks to build a walkthrough, or when /lgtm prepare chains into
  this skill.
allowed-tools: "mcp__lgtm__set_walkthrough,mcp__plugin_lgtm_lgtm__set_walkthrough,Agent,Bash(git:*)"
---

# Walkthrough Skill

Generate a narrated walkthrough for an active LGTM review session. Calls the
`walkthrough-author` agent which writes a markdown file, then `set_walkthrough`
parses and submits it.

## Prerequisites

None. `set_walkthrough` auto-registers the project if needed. If you want the
review UI claimed for notifications, call `claim_reviews` separately (via the
`lgtm` skill). Walkthrough is independent of analysis — it can run with or
without `/lgtm analyze` having been run first.

## Pipeline

### Step 1: Find the base branch

1. First try `gh pr view --json baseRefName -q .baseRefName`. If it succeeds,
   fetch it with `git fetch origin <branch>` and use `origin/<branch>` as base.
2. Otherwise fall back to `main` (or `master` if `main` doesn't exist).

### Step 2: Author

Spawn the `walkthrough-author` agent. Pass:

```
REPO_PATH: <repo path>
BASE_BRANCH: <base branch>
OUTPUT_PATH: /tmp/lgtm-walkthrough.md
```

### Step 3: Submit

Call `set_walkthrough` with:
- `repoPath`: the repo path
- `walkthroughPath`: `/tmp/lgtm-walkthrough.md`

If the tool returns an error (parse failure, validation error), read the file to
diagnose, ask the agent to fix, and retry.

On success, tell the user how many stops were generated and that the walkthrough
is available in the review UI (press `W`).
