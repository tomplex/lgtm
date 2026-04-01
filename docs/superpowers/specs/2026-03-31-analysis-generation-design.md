# Analysis Generation Design

## Background

The analysis layer spec defines a structured JSON contract (`POST /analysis`) for enriching LGTM's review UI with per-file priority, phase, summary, category, thematic groupings, and an overall review strategy. That spec covers consumption only. This spec covers **generation** — how Claude Code produces the analysis JSON and submits it to the LGTM server.

## Constraints

- Runs entirely within Claude Code (no external API calls). The user pays for a Max subscription and wants to use their allocated usage.
- Quality over speed. The user is willing to wait up to 5 minutes for the best possible output.
- The LGTM server will eventually be managed by an MCP server scoped to the repo path. Every MCP call implicitly knows the working directory and can derive the server URL.
- The analysis skill will be packaged as part of a plugin.

## Architecture

A three-step pipeline orchestrated by a Claude Code skill:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  File Analysis   │     │   Synthesis      │     │   Main Claude   │
│  (sub-agent)     │────▶│   (sub-agent)    │────▶│   (validation   │
│                  │     │                  │     │    + POST)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                                │
        ▼                                                ▼
  curl GET /analysis-diff                      curl POST /analysis
```

### Step 1: File analysis sub-agent

Spawned by the skill. Fetches the LLM-optimized diff from the LGTM server via `curl GET /analysis-diff`, then produces per-file analysis for every file in the diff.

**Output:** A JSON object keyed by file path, where each value has `priority`, `phase`, `summary`, and `category`.

### Step 2: Synthesis sub-agent

Receives the per-file analysis JSON from step 1. Produces:
- `overview` — 1-3 sentence PR summary: what it does, key decisions, risk areas
- `reviewStrategy` — suggested review order and approach
- `groups` — thematic file groupings, ordered by review importance

Also receives the session description for context. Does not need the raw diff — the per-file summaries and categories provide enough context for holistic reasoning.

### Step 3: Main Claude validation + POST

Main Claude merges the outputs from steps 1 and 2 into the final analysis JSON conforming to the `POST /analysis` contract, validates it, and submits via `curl POST /analysis`.

## Server endpoint: `GET /analysis-diff`

A new endpoint on the LGTM server that returns the branch diff in a format optimized for LLM consumption.

**Response format:**

```json
{
  "description": "Session description, if set",
  "manifest": [
    {
      "path": "auth/middleware.ts",
      "changeType": "added",
      "additions": 142,
      "deletions": 0
    },
    {
      "path": "auth/token.ts",
      "changeType": "modified",
      "additions": 38,
      "deletions": 12
    }
  ],
  "diff": "<full unified diff>"
}
```

**Fields:**

| Field | Description |
|-------|-------------|
| `description` | The session's description (context about what the branch is doing) |
| `manifest` | List of all files with path, change type (`added`/`modified`/`deleted`/`renamed`), and line stats. Gives the LLM the big picture before it reads the diff. |
| `diff` | Clean unified diff. No syntax highlighting, no extra noise. |

The manifest comes first so the LLM can orient itself before reading the full diff content.

## Rubrics

The skill provides these rubrics to the file analysis sub-agent.

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

Freeform short label. Examples: "core logic", "test", "migration", "config", "call-site update", "documentation", "build/CI", "types/interfaces".

### Summary

1-2 sentences. Answers: what changed and why a reviewer should care (or not). Focus on intent and risk, not diff narration — the reviewer can read the diff.

## Validation rules

Main Claude checks the merged JSON before POSTing:

1. **Coverage** — every file in the diff has an entry in the analysis (no gaps)
2. **No hallucinations** — no files in the analysis that aren't in the diff
3. **Valid enums** — priority is one of `critical`/`important`/`normal`/`low`; phase is one of `review`/`skim`/`rubber-stamp`
4. **Group integrity** — every file in a group exists in the files object; no file appears in multiple groups
5. **Non-empty text** — overview, reviewStrategy, and all summaries are non-empty strings
6. **Cross-axis consistency** — flag files that are "low" priority + "review" phase, or "critical" priority + "rubber-stamp" phase. These combinations aren't impossible but are suspicious enough to warrant a second look and correction.

If validation fails, main Claude fixes the issues itself (adds missing files with reasonable defaults, removes hallucinated paths, resolves inconsistencies) rather than re-running the sub-agents.

## Invocation

The skill is invoked explicitly (e.g., `/analyze`) or by Claude Code as part of a review workflow. The skill:

1. Determines the LGTM server URL (via MCP context — the MCP server is scoped to the repo path and knows the port)
2. Spawns the file analysis sub-agent with the rubrics and instructions to `curl GET /analysis-diff`
3. Spawns the synthesis sub-agent with the file analysis output
4. Validates and POSTs via `curl POST /analysis`

## Scaling

For the common case (500-2,500 lines of diff), the file analysis sub-agent handles everything in a single pass. For the worst case (~15K lines), the diff still fits within Claude's context window, so no chunking is needed.

If future diffs exceed context limits, step 1 can be parallelized: split the diff into file groups, spawn multiple file analysis sub-agents in parallel, then merge results before synthesis. This is a drop-in replacement for step 1 that doesn't change the rest of the pipeline.

## Out of scope

- **MCP server design.** The MCP server that manages LGTM instances, exposes tools, and provides repo context is a separate spec.
- **Skill packaging.** How the skill is packaged and distributed as part of a plugin.
- **Prompt tuning.** The exact prompt text for each sub-agent. The rubrics above define the criteria; prompt wording will be iterated during implementation.
- **Streaming/progress.** No progress indicators during analysis generation for v1. The user sees Claude Code working and gets the result when it's done.
