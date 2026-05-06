# Iterative Analysis Refresh — Design

## Background

Today the analysis pipeline is wholesale. To regenerate analysis, the `/lgtm analyze` skill spawns `file-classifier` to read `git diff` for every changed file, spawns `synthesizer` over the full output, and calls `set_analysis` — which replaces `_analysis` in its entirety on the session. Intermediate artifacts (`/tmp/lgtm-analysis-*.md`) are throwaway; the canonical state is the parsed JSON in SQLite.

On a long-lived branch, files change incrementally. Keeping analysis fresh today means redoing the whole run every time. That's expensive enough that it rarely happens, so analysis goes stale and stops being trusted as a review prioritization aid.

The fix is twofold: make LGTM the canonical persistence layer for analysis (so Claude can read previous analysis back without local files), and make the operation incremental (so re-classifying three changed files doesn't re-classify the other forty).

## Goals

- A file's analysis can be refreshed without re-running the whole pipeline when only some files have changed.
- LGTM persists analysis canonically; agents read prior analysis via MCP, not from `/tmp`.
- The reviewer sees per-file staleness in the UI and can trigger a refresh from the UI.
- All Claude-bound notifications remain human-initiated. No server-generated stale-events.
- Refresh works without channels — pull-first, push as best-effort UX layer.

## Non-goals

- **No `analysis_stale` push event.** Server-initiated notifications during Claude's own commit activity would generate noise Claude already knows about.
- **No per-component synthesis updates.** Overview / strategy / groups don't track freshness independently. Synthesis re-runs whenever any file analysis changes; the cost is one cheap agent pass.
- **No LGTM-managed Claude Code instance.** Compatible with this design (a managed Claude is just another claimer), but a separate architectural effort.
- **No walkthrough refresh in this spec.** The same pattern applies. Defer until iterative analysis ships and we have usage data.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Source of truth | LGTM SQLite — no `/tmp/*.md` artifacts persist across runs | Eliminates transient state; agents read prior analysis via MCP. |
| Freshness primitive | sha1 of `git diff <base>...HEAD -- <file>` per file | Captures both file changes and base-branch advances. Cheap, recomputable on demand. |
| Synthesis freshness | Stale when any file is stale OR the file set changed | Synth is holistic; partial updates are not worth the prompt complexity. |
| Refresh API | `set_analysis(..., mode: "replace" \| "merge")` | One tool, two behaviors. Merge preserves files not in the new payload. |
| Read-back | New MCP tool `read_analysis()` | Returns JSON + rendered markdown for agent input. |
| Trigger model | Pull-first; UI button generates a human-initiated channel message | Matches the rule: all push-to-Claude is human-initiated. |
| Connection state | MCP transport liveness + `claim_reviews` claim state | Reliable enough to gate UI affordances; mid-turn opacity is fine because notifications queue. |

## Data model

Restructure `_analysis` from an opaque blob to:

```ts
type FileAnalysis = {
  path: string;
  priority: 'critical' | 'important' | 'normal' | 'low';
  phase: 'review' | 'skim' | 'rubber-stamp';
  category: string;
  summary: string;
  // Freshness metadata
  analyzedAtSha: string;       // HEAD SHA when this entry was written
  diffHash: string;            // sha1 of `git diff <base>...HEAD -- <path>` at that SHA
};

type Synthesis = {
  overview: string;
  strategy: string;
  opinion: string;
  groups: ThematicGroup[];
  synthesizedAtSha: string;
  fileSet: string[];           // sorted paths in scope at synthesis time
};

type Analysis = {
  files: FileAnalysis[];
  synthesis: Synthesis | null;
};
```

The frontend continues to receive a single `analysis` JSON object, augmented with a freshness field computed on read:

```ts
type AnalysisFreshness = {
  staleFiles: string[];        // paths whose current diffHash differs from stored
  missingFiles: string[];      // paths in current diff but not in analysis
  removedFiles: string[];      // paths in analysis but not in current diff
  staleSynthesis: boolean;     // any of the above is non-empty
  computedAt: string;          // ISO timestamp; cached briefly server-side
};
```

**Migration.** Existing `_analysis` blobs without per-file freshness metadata are treated as fully stale on first read. Detection: if a file entry lacks `diffHash`, the freshness check treats its stored hash as empty string, which never matches the recomputed value — so every legacy entry surfaces as `staleFiles`. The next refresh re-hydrates with current SHAs. No migration script needed; the read path tolerates the legacy shape and the next `set_analysis` writes the new shape.

## API surface

### REST

- `GET /project/:slug/analysis` — current analysis + freshness, computed on demand, cached for ~5s server-side to absorb UI bursts.
- `GET /project/:slug/analysis/freshness` — freshness only; cheaper for UI polling and for the `/lgtm refresh` skill's pre-check.
- `GET /project/:slug/connection-state` — `{claimed: bool, alive: bool, claimedAt: string | null}`. Drives the refresh button's enabled state and the header connection indicator.

### MCP tools

- **`read_analysis(repoPath)`** — returns `{json, markdown, freshness}`.
  - `markdown` is the file-classifier-format rendering of the previous file analysis, suitable for passing to the agent as prior context. Generated on demand from the JSON; not stored.
  - `freshness` is the same shape returned by `GET /analysis/freshness`.
- **`set_analysis(repoPath, fileAnalysisPath, synthesisPath, reviewGuidePath?, mode?, removedFiles?)`** — `mode` defaults to `"replace"` for backwards compat.
  - `mode: "merge"` parses the new file analysis md, merges entries by path (new overwrites old; entries in old-but-not-new are preserved unless they appear in `removedFiles`), and replaces the synthesis wholesale. `removedFiles` is a list of paths to drop from the merged result; the skill computes it from `freshness.removedFiles`. The agent only outputs entries for files it (re-)classified — preservation of unchanged entries happens server-side. The server stamps `analyzedAtSha` and recomputes `diffHash` for every entry it writes; the agent does not need to compute these.

### UI

- **Per-file staleness badge** in the sidebar (small icon, hover tooltip "diff has changed since last analysis").
- **Stale count chip** in the analysis tab header ("3 files stale").
- **"Refresh analysis" button** next to the existing "Run analysis" affordance.
  - Enabled when a Claude is claimed and alive for this project.
  - Disabled with a fallback "Copy refresh prompt" affordance otherwise.
  - Clicking enabled: pushes a human-initiated channel message of shape `{type: "refresh_analysis_requested", staleFiles, missingFiles, removedFiles}` to the claimed Claude. Same delivery path as review submission.
- **Connection indicator** in the header: small dot showing whether a Claude is currently claimed for this project. Drawn from `GET /connection-state`.

## Skill flow

### `/lgtm refresh` (new skill)

1. Call `read_analysis(repoPath)`. If no prior analysis exists, fall through to a full `/lgtm analyze` run.
2. Inspect the returned `freshness`. If `staleFiles`, `missingFiles`, and `removedFiles` are all empty, report "analysis is fresh" and exit.
3. Write the previous analysis markdown (from `read_analysis`) to `/tmp/lgtm-analysis-files-prev.md` as scratch input for the agent.
4. Spawn `file-classifier` with a prompt that includes:
   - The previous analysis md as prior context (so the agent sees the existing categories and can produce consistent classifications for related files).
   - The list of files to (re-)classify: `staleFiles ∪ missingFiles`.
   - Instruction to output **only** entries for those files. The server preserves unchanged entries; the agent does not copy them forward.
5. Locally compose the merged file analysis (previous entries minus `removedFiles`, overlaid with the new entries) and write it to `/tmp/lgtm-analysis-files-merged.md`. This is the input to synthesizer.
6. Spawn `synthesizer` on the merged file analysis (existing behavior; no changes).
7. Call `set_analysis(..., mode: "merge", removedFiles: freshness.removedFiles)` — passing the *agent's delta-only* file analysis md plus the explicit removal list. The server merges, stamps freshness metadata, and broadcasts on the existing SSE channel.

### `/lgtm analyze` (modified)

- If no prior analysis exists: full pipeline (current behavior).
- If prior analysis exists and freshness reports anything stale/missing/removed: delegate to `/lgtm refresh` flow.
- If prior exists and nothing stale: report current state and exit.

One entry point; behavior keys off persisted state.

## Connection state detection

The MCP server already routes `claim_reviews` claims into a per-project record. Extend the record with transport liveness:

```ts
type Claim = {
  slug: string;
  sessionId: string;          // MCP session id
  claimedAt: string;
  // Tracked by the MCP transport layer:
  transportAlive: boolean;
};
```

On MCP transport disconnect (explicit or close), the server flips `transportAlive` to `false` for any claims held by that session id. `GET /connection-state` returns `{claimed: <claim exists>, alive: <claim exists && transportAlive>, claimedAt}`.

The server cannot tell whether a connected Claude is mid-turn — that's opaque from MCP's side. That's fine: human-initiated channel messages queue and deliver on the next idle moment. The "Claude is mid-turn ignoring server notifications" failure mode we want to avoid is specifically server-generated events triggered by activity Claude itself caused, which this design eliminates.

## Agent prompt updates

`file-classifier` agent gets a new optional input shape: previous analysis md + a list of files to re-classify + a list to drop. When given these, the agent:

- Re-classifies only the listed files.
- Drops the listed files from output.
- Copies all other entries from the previous analysis verbatim.
- Outputs the merged file analysis in the existing markdown format.

When the previous-analysis input is absent (full run), behavior is unchanged.

`synthesizer` agent is unchanged. It always receives the full (merged) file analysis and synthesizes from scratch.

## Testing

- **Unit:** freshness computation across git states (file unchanged, file content changed, base advanced, file added since analysis, file removed since analysis, file rename).
- **Unit:** `set_analysis` merge mode — overlapping file sets preserve correct entries; `removedFiles` parameter drops entries; legacy blob shape (no freshness metadata) is treated as fully stale.
- **Integration:** full `/lgtm analyze` run → make a commit affecting one file → call `/lgtm refresh` → verify the file-classifier prompt only listed the changed file → verify final state has the new entry plus the old entries verbatim.
- **Integration:** connection-state endpoint reflects MCP transport disconnect within ~1s.

## Open questions

- **Should `read_analysis()` return only the most recent analysis, or also a brief history (last N)?** YAGNI — defer until a use case appears for "show me how priorities shifted."
- **Should the UI auto-refresh staleness display on `git_changed` SSE events?** Yes; this is server → browser, not server → Claude, so the noise concern doesn't apply. Cheap to implement using the existing event path. Including this in implementation.

## Out-of-scope future work

- **LGTM-managed Claude Code instance.** A background Claude process owned by LGTM, used for triggered tasks (refresh, walkthrough generation, specialist passes) without depending on the user's interactive session being available. The current design is forward-compatible: such a process would simply be another claimer.
- **Walkthrough refresh.** Mirror structure (per-stop freshness or whole-walkthrough staleness). Defer until analysis refresh is in real use.
- **Per-component synthesis updates.** Overview / strategy / groups as separately stale. Defer; the "synth re-runs cheaply" assumption may not hold for very large branches.
