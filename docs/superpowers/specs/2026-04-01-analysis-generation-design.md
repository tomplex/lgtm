# Analysis Generation Design

## Background

LGTM's analysis layer enriches the review UI with per-file priority, phase, summary, category, thematic groupings, and an overall review strategy. The consumption side (backend storage, frontend types, pure functions, UI rendering) is built. This spec covers **generation** — how Claude Code produces the analysis JSON and submits it to the LGTM server.

## Constraints

- Runs entirely within Claude Code (no external API calls). Uses the Max subscription's allocated usage.
- Quality over speed. Up to 5 minutes is acceptable for the best possible output.
- The LGTM MCP server is the interface — all interaction with the review server goes through MCP tools.
- This will be packaged as a skill within a plugin.

## MCP tools used

| Tool | Purpose |
|------|---------|
| `review_get_diff` | Fetch LLM-optimized diff (manifest + unified diff) for analysis input |
| `review_set_analysis` | Submit the completed analysis JSON to the server |

## Pipeline

Three steps, orchestrated by the skill:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  File Analysis   │     │   Synthesis      │     │   Main Claude   │
│  (sub-agent)     │────▶│   (sub-agent)    │────▶│   (validation   │
│                  │     │                  │     │    + submit)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                                │
        ▼                                                ▼
  review_get_diff                              review_set_analysis
```

### Step 1: File analysis sub-agent

Spawned by the skill. Calls `review_get_diff` to get the diff with file manifest, then produces per-file analysis for every file.

**Input:** The LLM-optimized diff payload (description, manifest, unified diff).

**Output:** A JSON object keyed by file path, where each value has `priority`, `phase`, `summary`, and `category`.

The sub-agent receives the rubrics (below) as part of its prompt and classifies all axes together per file so they remain internally consistent.

### Step 2: Synthesis sub-agent

Receives the per-file analysis JSON from step 1, plus the session description for context. Does not need the raw diff.

**Output:**
- `overview` — 1-3 sentence PR summary: what it does, key decisions, risk areas
- `reviewStrategy` — suggested review order and approach
- `groups` — thematic file groupings, ordered by review importance

### Step 3: Main Claude validation + submit

Main Claude merges the outputs from steps 1 and 2 into the final analysis JSON, validates it, and submits via `review_set_analysis`.

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

1-2 sentences. Answers: what changed and why a reviewer should care (or not). Focus on intent and risk, not diff narration.

## Validation rules

Main Claude checks the merged JSON before submitting:

1. **Coverage** — every file in the diff manifest has an entry in the analysis
2. **No hallucinations** — no files in the analysis that aren't in the manifest
3. **Valid enums** — priority is one of `critical`/`important`/`normal`/`low`; phase is one of `review`/`skim`/`rubber-stamp`
4. **Group integrity** — every file in a group exists in the files object; no file appears in multiple groups
5. **Non-empty text** — overview, reviewStrategy, and all summaries are non-empty strings
6. **Cross-axis consistency** — flag files that are "low" priority + "review" phase, or "critical" priority + "rubber-stamp" phase. Not impossible, but suspicious — warrants a second look and likely correction.

If validation fails, main Claude fixes the issues itself (adds missing files with reasonable defaults, removes hallucinated paths, resolves inconsistencies) rather than re-running the sub-agents.

## Scaling

For the common case (500-2,500 lines), the file analysis sub-agent handles everything in a single pass. For the worst case (~15K lines), the diff still fits within Claude's context window, so no chunking is needed.

If future diffs exceed context limits, step 1 can be parallelized: split the manifest into file groups, spawn multiple file analysis sub-agents in parallel, then merge results before synthesis.

## Out of scope

- **MCP server design.** Already implemented separately.
- **Skill packaging.** How the skill is packaged and distributed as part of a plugin.
- **Prompt tuning.** The exact prompt text for each sub-agent. The rubrics define the criteria; prompt wording will be iterated during implementation.
- **Streaming/progress.** No progress indicators during generation for v1.
