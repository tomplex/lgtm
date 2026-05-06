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
| Freshness primitive | Blob-SHA pair `(oldBlob, newBlob)` from one `git diff --raw <base>...HEAD` invocation per freshness check | Captures both file changes and base-branch advances. One git spawn for the whole branch instead of N. Working-tree edits are deliberately ignored (review is for committed work). |
| Synthesis freshness | Stale when any file is stale OR the file set changed | Synth is holistic; partial updates are not worth the prompt complexity. |
| On-disk shape | Keep existing `{overview, reviewStrategy, files: Record<path, FileAnalysis>, groups}` and add per-entry freshness fields + a top-level `freshness` block | Avoids breaking `frontend/src/analysis.ts` which assumes map-keyed `files`. Migration becomes additive. |
| Refresh API | `set_analysis(..., mode: "replace" \| "merge", removedFiles?)` | One tool, two behaviors. Merge preserves files not in the new payload; `removedFiles` is the explicit drop list. |
| Read-back | New MCP tool `read_analysis()` | Returns JSON + rendered markdown for agent input. |
| Update broadcast | New SSE event `analysis_changed` on every `set_analysis` write | Matches the existing `git_changed`, `comments_changed`, `walkthrough_changed` pattern. Today's `set_analysis` doesn't broadcast at all. |
| Trigger model | Pull-first; UI button generates a human-initiated channel message via a new REST route | Matches the rule: all push-to-Claude is human-initiated. |
| Connection state | MCP transport-entry presence + `claim_reviews` claim state | Reflects "transport is in `activeMcpSessions`," which catches explicit disconnect but not crash/half-open. Sufficient for gating UI affordances; heartbeat is future work. |

## Data model

Augment the existing `_analysis` shape additively. The current shape stays:

```ts
type FileAnalysis = {
  path: string;
  priority: 'critical' | 'important' | 'normal' | 'low';
  phase: 'review' | 'skim' | 'rubber-stamp';
  category: string;
  summary: string;
  // NEW — freshness metadata, written by the server on every `set_analysis` entry
  analyzedAtBaseBlob: string;  // blob SHA of <base>:<path> when this entry was written
  analyzedAtHeadBlob: string;  // blob SHA of HEAD:<path> when this entry was written
};

type Analysis = {
  overview: string;            // unchanged
  reviewStrategy: string;      // unchanged
  files: Record<string, FileAnalysis>;  // unchanged shape (map keyed by path)
  groups: ThematicGroup[];     // unchanged
  // NEW — synthesis-level provenance, used to detect "synth is stale"
  synthesizedAtFileSet: string[];  // sorted paths covered by the last synthesis
};
```

The freshness primitive is the blob-SHA pair: a file's stored `(analyzedAtBaseBlob, analyzedAtHeadBlob)` is compared to the *current* `(baseBlob, headBlob)` from a single `git diff --raw <base>...HEAD` invocation. Mismatch on either side = stale. This catches both file content changes and base-branch advances in one git call.

The `GET /project/:slug/analysis` response is augmented with a top-level `freshness` field (frontend doesn't touch the existing fields):

```ts
type AnalysisFreshness = {
  staleFiles: string[];        // paths whose current blob pair differs from stored
  missingFiles: string[];      // paths in current diff but not in `files`
  removedFiles: string[];      // paths in `files` but not in current diff
  staleSynthesis: boolean;     // any of the above is non-empty OR fileSet differs
  computedAtHead: string;      // HEAD SHA at compute time, used as cache key
  computedAtBase: string;      // base SHA at compute time, used as cache key
};
```

Server-side freshness cache is keyed on `(headSha, baseSha)` — when neither has moved, the cached freshness is valid indefinitely. The 5s wall-clock TTL on the analysis endpoint is just to absorb UI bursts within a single SHA pair.

**Migration.** Existing `_analysis` blobs lack `analyzedAtBaseBlob` / `analyzedAtHeadBlob` per file and `synthesizedAtFileSet` at the top level. Detection: if a file entry lacks `analyzedAtHeadBlob`, freshness treats its stored pair as empty strings, which never matches the recomputed pair — so every legacy entry surfaces as `staleFiles`. Synthesis is stale because `synthesizedAtFileSet` is empty (or absent). The next `set_analysis` (replace or merge) writes the new fields. No migration script needed; the read path tolerates absent fields. Frontend keeps consuming the unchanged top-level fields; only new components that render staleness indicators look at `freshness`.

## API surface

### REST

- `GET /project/:slug/analysis` — current analysis + freshness, computed on demand. Cached server-side keyed by `(headSha, baseSha)` plus a 5s wall-clock TTL on the keyed entry to absorb UI bursts.
- `GET /project/:slug/analysis/freshness` — freshness only; cheaper for UI polling and for the `/lgtm refresh` skill's pre-check. Same cache.
- `GET /project/:slug/connection-state` — `{claimed: bool, alive: bool, claimedAt: string | null}`. Drives the refresh button's enabled state and the header connection indicator. `alive` reflects "transport entry present in `activeMcpSessions`," which catches explicit close but not crash/network drop — see Connection state detection below.
- `POST /project/:slug/refresh-analysis` — UI-triggered. Server packs freshness data into a channel-message payload and sends it via the existing `notifyChannel` path. Returns `{delivered: bool, reason?: string}` so the UI can show a success toast or fall back to "copy prompt."

### MCP tools

- **`read_analysis(repoPath)`** — returns `{json, markdown, freshness}`.
  - `markdown` is the file-classifier-format rendering of the previous file analysis, suitable for passing to the agent as prior context. Generated on demand from the JSON; not stored. Note: this roundtrip is *lossy* for multiline summaries — `parse-analysis.ts` joins summary lines with a single space, so the rendered markdown won't reproduce paragraph breaks. The agent prompt should not promise verbatim copy of unchanged entries.
  - `freshness` is the same shape returned by `GET /analysis/freshness`.
- **`set_analysis(repoPath, fileAnalysisPath, synthesisPath, reviewGuidePath?, mode?, removedFiles?)`** — `mode` defaults to `"replace"` for backwards compat.
  - `mode: "merge"` parses the new file analysis md, merges entries by path (new overwrites old; entries in old-but-not-new are preserved unless they appear in `removedFiles`), and replaces the synthesis wholesale. `removedFiles` is a list of paths to drop from the merged result; the skill computes it from `freshness.removedFiles`. The agent only outputs entries for files it (re-)classified — preservation of unchanged entries happens server-side. The server stamps `analyzedAtBaseBlob` and `analyzedAtHeadBlob` (from a single `git diff --raw <base>...HEAD` query) for every entry it writes; the agent does not need to compute these.

### UI

- **Per-file staleness badge** in the sidebar (small icon, hover tooltip "diff has changed since last analysis").
- **Stale count chip** in the analysis tab header ("3 files stale").
- **"Refresh analysis" button** next to the existing "Run analysis" affordance.
  - Enabled when a Claude is claimed and alive for this project.
  - Disabled with a fallback "Copy refresh prompt" affordance otherwise (a static instruction with the project slug, e.g. "Run `/lgtm refresh` for project `<slug>`").
  - Clicking enabled: `POST /project/:slug/refresh-analysis`. The server JSON-encodes the freshness payload into the channel-message `content` (string), with `meta = {event: "refresh_analysis_requested", project: slug}`. Same delivery primitive as review submission (`notifyChannel`); only the `meta.event` value is new.
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
7. Call `set_analysis(..., mode: "merge", removedFiles: freshness.removedFiles)` — passing the *agent's delta-only* file analysis md plus the explicit removal list. The server merges, stamps freshness metadata (blob SHAs from the same `git diff --raw` query), and broadcasts a new `analysis_changed` SSE event so connected browsers refresh.

### `/lgtm analyze` (modified)

- If no prior analysis exists: full pipeline (current behavior).
- If prior analysis exists and freshness reports anything stale/missing/removed: delegate to `/lgtm refresh` flow.
- If prior exists and nothing stale: report current state and exit.

One entry point; behavior keys off persisted state.

## Connection state detection

The current MCP layer tracks claims as a per-MCP-session `claimedDiff` flag inside `activeMcpSessions` (see `server/mcp.ts`). There is no per-project claim record today. Introduce one:

```ts
type ProjectClaim = {
  slug: string;
  sessionId: string;          // MCP session id of the claiming Claude
  claimedAt: string;
};

// Keyed by slug, with a reverse index from sessionId for cleanup
// when the transport entry is removed from activeMcpSessions.
```

When the MCP transport entry for `sessionId` is removed from `activeMcpSessions` (the existing `transport.onclose` path), the corresponding claim is dropped. `GET /connection-state` returns:

```ts
{
  claimed: boolean;            // true iff a ProjectClaim exists for this slug
  alive: boolean;              // claimed AND that sessionId is still in activeMcpSessions
  claimedAt: string | null;
}
```

**Liveness limitations.** `transport.onclose` fires for explicit disconnect, but does not reliably detect a half-open TCP, a wedged Claude process, or a network drop on the streamable-HTTP transport. `alive: true` means "we haven't been told the transport died" — not "we just ping-pong'd." This is sufficient for gating the UI's refresh button: worst case, the user clicks refresh, the channel message goes nowhere, `notifyChannel` fails or times out, `POST /refresh-analysis` returns `{delivered: false}`, and the UI falls back to "copy prompt." A heartbeat / TTL on the claim record is **future work**, captured in out-of-scope.

The server still cannot tell whether a connected Claude is mid-turn — opaque from MCP's side. That's fine: human-initiated channel messages queue and deliver on the next idle moment. The failure mode we're avoiding (server-generated events during Claude's own commit activity) is eliminated by the no-`analysis_stale`-event decision, not by liveness detection.

## Agent prompt updates

`file-classifier` agent gets a new optional input shape: previous analysis md (for category/style continuity) + a list of files to re-classify. When given these, the agent:

- Reads the previous analysis to inform consistent classifications (categories, terminology) but does **not** copy unchanged entries forward.
- Re-classifies only the listed files.
- Outputs **only** entries for those files in the existing markdown format.

When the previous-analysis input is absent (full run), behavior is unchanged.

`synthesizer` agent is unchanged. It always receives the full merged file analysis (composed by the skill from previous + delta minus `removedFiles`) and synthesizes from scratch.

## Testing

- **Unit:** freshness computation across git states (file unchanged, file content changed via new commit, base advanced affecting a file, file added since analysis, file removed since analysis, file rename surfacing as add+remove).
- **Unit:** `git diff --raw` parsing — verify the blob-pair extraction handles add (`0000…` old blob), delete (`0000…` new blob), and rename (`R100` status).
- **Unit:** `set_analysis` merge mode — overlapping file sets preserve correct entries; `removedFiles` drops entries; legacy blob shape (no freshness metadata) is treated as fully stale; replace mode behaves as it does today.
- **Integration:** full `/lgtm analyze` run → make a commit affecting one file → call `/lgtm refresh` → verify the file-classifier prompt only listed the changed file → verify final state has the new entry plus the old entries unmodified.
- **Integration:** `analysis_changed` SSE event fires on `set_analysis` writes (replace and merge); frontend listener triggers a refetch.
- **Integration:** `POST /refresh-analysis` calls `notifyChannel` with the right `meta.event`; returns `{delivered: false}` when no live claim exists.
- **Integration:** `connection-state` endpoint reports `alive: false` after explicit MCP transport close. Crash/half-open is **not** tested — that's the documented liveness limitation.

## Open questions

- **Should `read_analysis()` return only the most recent analysis, or also a brief history (last N)?** YAGNI — defer until a use case appears for "show me how priorities shifted."
- **Should the UI auto-refresh staleness display on `git_changed` SSE events?** Yes; this is server → browser, not server → Claude, so the noise concern doesn't apply. Cheap to implement using the existing event path. Including this in implementation.

## Out-of-scope future work

- **Heartbeat / TTL on claim records.** The current "alive" signal misses crashes and half-open TCPs. A periodic ping (server → Claude via MCP) with a TTL on the claim would close the gap. Out of scope for this design; the fallback "copy prompt" affordance covers the failure case adequately for v1.
- **LGTM-managed Claude Code instance.** A background Claude process owned by LGTM, used for triggered tasks (refresh, walkthrough generation, specialist passes) without depending on the user's interactive session being available. The current design is forward-compatible: such a process would simply be another claimer.
- **Walkthrough refresh.** Mirror structure (per-stop freshness or whole-walkthrough staleness). Defer until analysis refresh is in real use.
- **Per-component synthesis updates.** Overview / strategy / groups as separately stale. Defer; the "synth re-runs cheaply" assumption may not hold for very large branches.
