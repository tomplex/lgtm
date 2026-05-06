# LGTM-Managed Claude — Design

## Background

LGTM today is a passive substrate. The user runs `claude` in their terminal, that interactive session calls MCP tools (`set_analysis`, `set_walkthrough`, `comment`, `reply`, `read_feedback`), and the server stores/serves results. Generation tasks — analysis, walkthrough, replies to direct questions — happen entirely inside the user's interactive session.

Two costs follow from that:

- **Generation steals attention from collaboration.** A 60-second walkthrough run blocks the interactive session the user wanted to use for actual review back-and-forth. Many reviewers give up on regenerating because of the context-switch cost.
- **The UI can only ask, not act.** Today's "Refresh analysis" button (per `iterative-analysis-design.md`) sends a channel notification to the user's claimed claude. If no claude is claimed, the button is disabled with a "copy prompt" fallback. The UI is asking the user's claude to please do the work — never just doing it.

The fix: LGTM owns its own claude subprocess for generation work. UI buttons spawn one. The user's interactive claude stays free for collaborative review.

The recent `iterative-analysis-design.md` already names this as out-of-scope-but-forward-compatible: "a managed Claude is just another claimer." This spec fills that gap.

## Goals

- **UI buttons spawn managed claude.** Regenerate analysis, regenerate walkthrough, and direct-question replies are all driven by managed-claude subprocesses spawned by the LGTM server.
- **One-shot subprocess per request.** Each click = one fresh `claude -p ...` invocation. No persistent state across runs.
- **Live transcript in the UI.** Claude's stdout streams to the browser as it arrives. The user sees what's happening, not a 60-second spinner.
- **Failure surfaces loudly.** Non-zero exit code, spawn error, server-restart-while-running — each lands as a visible failed-pill with an inline log viewer.
- **The interactive-claude flow is unchanged.** User-driven `/lgtm refresh`, `/lgtm walkthrough`, etc. typed in their terminal still work. Managed claude is additive.

## Non-goals

- **No background regeneration.** No file-watcher, no polling, no auto-fire-on-stale. Every managed-claude run is a user button click.
- **No cancel-while-running.** v0 punts. If a run hangs, the user waits or restarts the LGTM server. Cancel is in out-of-scope.
- **No cost capping.** Tom's max-plan covers token costs. No per-project rate limit, no daily budget. If this becomes a problem in practice, address it separately.
- **No worktree-managed projects.** The cmd-K-PR-by-number idea (creating a project on the fly from `gh pr checkout` into a worktree) is a separate spec that builds on this one. v0 only manages claude inside already-registered projects.
- **No multi-user.** LGTM is local-only. Managed claude inherits the user's `~/.claude/` auth.
- **No conversation context across runs.** Each managed-claude run is a fresh `-p` invocation with no memory of prior runs. (User-driven prior context, e.g. previous analysis read via `read_analysis`, still works — but that's pulled inside the run, not preserved across them.)
- **No interactive-claude fallback for UI buttons.** The previous `iterative-analysis-design.md` flow — UI button sends channel notification to claimed claude — is replaced. UI buttons always spawn managed claude.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Process model | One-shot `claude -p "<prompt>" --permission-mode bypassPermissions` subprocess per request, `cwd = project.repoPath` | "Fresh session per generation" mapped directly onto the CLI's one-shot mode. `--permission-mode bypassPermissions` is load-bearing: without it, every first-touch of an MCP tool prompts for permission, and there's no human at the keyboard to answer — the subprocess hangs forever. The trust assumption is fine: the subprocess is local, the prompts come from skills the project author wrote, and the spawned claude is invoked with explicit user intent (button click). |
| Project identification | CWD only — the spawned claude calls existing MCP tools (`claim_reviews`, `set_analysis`, `reply`) which already infer project from repo path | No project ID juggling, no env var, no MCP config rewriting. Inherits the user's installed plugin config as-is. |
| Concurrency | One in-flight job per `(project, kind, subjectId)`. Button disabled while running. No queue. Different projects/kinds run concurrently. | Matches user expectation. Queue adds complexity without obvious value at v0. |
| In-flight rerun | Click-while-running is a no-op (button is disabled). No cancel. | YAGNI; cancel is out-of-scope. |
| Live transcript | Server pipes stdout/stderr line by line, broadcasts via SSE `claude_stream` event | Trust + immediate feedback. 60 seconds without signal feels broken; with signal it feels like the system is working. |
| Job persistence | `managed_jobs` table in SQLite. Server-restart marks `running` rows as `failed` with reason `server-restarted`. | Survives restarts. UI sees the failed state and offers a Retry. |
| Failure surfacing | stderr + exit code + last 200 lines preserved with the job row. UI: failed pill → click → inline log viewer. | Enough context to diagnose without leaving the browser. |
| Direct-question trigger | Existing "Ask Claude" button on the comment editor. Server-side: when a comment with `mode='direct'` and no `parentId` is created, server enqueues a managed-claude `comment-reply` job. | Trigger point already exists in the UI. The change is what the server does on receipt — no longer `notifyChannel`, instead `enqueueJob`. |
| Reply prompt | New `/lgtm answer` skill, invoked as `claude -p "/lgtm answer <commentId>"`. Skill reads the comment via MCP, gathers context, posts via `reply`. | Keeps prompts in versioned skill files, editable, testable. Symmetric with `/lgtm refresh`, `/lgtm walkthrough`. |
| Generation prompts | Analysis: `claude -p "/lgtm refresh"`. Walkthrough: `claude -p "/lgtm walkthrough"`. | Reuses existing skills. |
| First-open banner | Banner appears when neither analysis nor walkthrough exists. Three buttons: "Generate both" / "Just analysis" / "Skip". Per-project skip flag persists. | Discoverable. Skip is sticky so it doesn't nag. |
| Per-project running indicator | Small dot in the project header during any active job for that project. No global aggregate indicator. | Per-project view already where the user is; global indicators tend to mislead. |
| Auth | Spawned claude inherits the user's environment (`HOME`, `PATH`, `~/.claude/`). | Local-only assumption already established. |
| Tool surface | Spawned claude inherits the user's full plugin install (gh, github, gcloud, refactor, etc., plus lgtm). v0 does NOT pass `--allowed-tools` to constrain. | Trust assumption: max-plan, local, single-user, button-driven. A misbehaving spawned claude could in principle call any plugin tool. The constraint option (`--allowed-tools "mcp__lgtm__* Read Bash(git:*) Grep Glob"`) is documented as future-work in case real-world behavior demands it. |

## Hard dependency

This spec depends on `iterative-analysis-design.md` shipping first. Specifically:

- The `/lgtm refresh` skill introduced there is what managed-claude's analysis-regenerate path invokes. Walkthrough-regenerate calls the existing `/lgtm walkthrough`.
- Three pieces of the iterative-analysis spec are **superseded** by this one when it lands and should be dropped from that spec's implementation:
  - `POST /project/:slug/refresh-analysis` REST route (replaced by `POST /project/:slug/jobs` with `kind='analysis'`).
  - The "claimed and alive" gating on the Refresh-analysis button (managed-claude buttons are always enabled because the supervisor itself spawns the worker).
  - The "Copy refresh prompt" fallback affordance (no longer needed; if managed-claude proves unreliable in practice, restoring the fallback is a future-work item).

The two specs were written in the same session and are intended to land sequentially.

## Architecture

### New module: `server/managed-claude.ts`

A process supervisor and job store. Public surface:

```ts
type JobKind = 'analysis' | 'walkthrough' | 'comment-reply';

type ManagedJob = {
  id: number;                  // sqlite autoincrement
  projectSlug: string;
  kind: JobKind;
  subjectId: string | null;    // commentId for comment-reply, null otherwise
  status: 'running' | 'succeeded' | 'failed';
  pid: number | null;
  startedAt: string;           // ISO timestamp
  finishedAt: string | null;
  exitCode: number | null;
  failureReason: string | null;  // 'exit-nonzero' | 'spawn-error' | 'server-restart'
  lastLines: { source: 'stdout' | 'stderr'; line: string }[];  // last ~200
};

// Spawn a job. Throws if one is already running for (slug, kind, subjectId).
function enqueueJob(slug: string, kind: JobKind, subjectId?: string): ManagedJob;

// Get the current (most recent) job for a given key.
function getCurrentJob(slug: string, kind: JobKind, subjectId?: string): ManagedJob | null;

// List all current jobs for a project (for the project header indicator).
function listCurrentJobs(slug: string): ManagedJob[];

// Server shutdown: kill any running subprocesses.
function shutdownAll(): Promise<void>;

// Boot-time recovery: mark any 'running' row as 'failed' with reason 'server-restart'.
function recoverFromCrash(): void;
```

Internal mechanics:

- `enqueueJob` looks up the prompt template by kind, builds the command (`claude -p "<rendered prompt>"`), spawns via `child_process.spawn` with `cwd = repoPath`, inherits `process.env`, captures stdout and stderr.
- Each captured line is broadcast as an SSE `claude_stream` event on the project's session AND appended to an in-memory ring buffer (capped at 200 entries) that's persisted to the row on completion or failure.
- On exit: row status moves to `succeeded` (exit 0) or `failed` (non-zero). SSE `claude_job_status` event fires with the new state.
- One-job-at-a-time enforced inside `enqueueJob`. Implementation:
  - For `analysis` and `walkthrough` kinds: `BEGIN IMMEDIATE` SQLite transaction wrapping the check-then-insert against `(projectSlug, kind, subjectId, status='running')`. Eliminates the race for repeat-clicks on the regenerate buttons.
  - For `comment-reply` kind specifically: key on `(projectSlug, kind, subjectId)` across **all** statuses. Once a reply has been started for a comment — running, succeeded, or failed — no second job for the same comment is ever enqueued. The trigger (`POST /comments`) can land twice (network retry, double-click on Save, browser bfcache) and would otherwise produce two replies under one question. Failed replies are explicitly retryable via a manual UI action that calls a separate endpoint, not via re-trigger from the comment-create path.

### Prompt templates

Templates live in `server/managed-claude.ts` as a small dispatch:

```ts
const promptByKind: Record<JobKind, (subjectId?: string) => string> = {
  'analysis':       () => '/lgtm refresh',
  'walkthrough':    () => '/lgtm walkthrough',
  'comment-reply':  (id) => `/lgtm answer ${id}`,
};
```

Three skills, all symmetric. The skills carry the prompt complexity, not the supervisor.

### REST API

- `GET /project/:slug/jobs` — returns `listCurrentJobs(slug)`. Used by the UI to populate per-project run state.
- `POST /project/:slug/jobs` — body `{kind, subjectId?}`. Calls `enqueueJob`. Returns 409 if one is already running for that key.
- `GET /project/:slug/jobs/:id` — full job record including all 200 cached lines. Used by the failed-state log viewer.
- `POST /project/:slug/banner-skip` — persists the per-project first-open banner skip flag.
- `GET /project/:slug` summary — extended to include `firstOpenBannerSkipped: boolean`.

### SSE events

Two new events on the existing project SSE channel:

- `claude_stream` — `{jobId, kind, subjectId, line, source: 'stdout' | 'stderr'}`. One event per line of subprocess output.
- `claude_job_status` — `{jobId, kind, subjectId, status, exitCode?, failureReason?, finishedAt?}`. Fires on state transitions (running → succeeded | failed).

Existing events (`comments_changed`, `analysis_changed`, `walkthrough_changed`, `git_changed`) continue to fire when the spawned claude calls the corresponding MCP tools, so artifacts refresh in the UI as the run completes its work.

### MCP changes

- **One new tool: `read_comment(commentId)`.** Returns:
  ```ts
  {
    comment: Comment;                       // full record from comment-types.ts
    fileContext: {                          // null for non-diff comments (item != 'diff')
      file: string;
      lineRange: { from: number; to: number };
      side: 'RIGHT' | 'LEFT';
      lines: { num: number; content: string }[];  // ±3 around the anchor
    } | null;
  }
  ```
  For `side === 'RIGHT'` (and unspecified, which defaults to RIGHT), `fileContext.lines` come from the working tree (`getFileLines` in `server/git-ops.ts`). For `side === 'LEFT'`, the lines come from the base SHA — the deleted content the user commented on. `read_feedback` already exists but only returns submitted-feedback batches; `read_comment` is the missing per-comment lookup.
- **All other tools unchanged.** The spawned claude uses existing `read_analysis`, `read_feedback`, `set_analysis`, `set_walkthrough`, `comment`, `reply`.
- **`autoClaimDiffReviewsIfUnheld` is suppressed during a managed-claude run.** Today, every MCP tool call lands in `resolveProject` (`server/mcp.ts:13`), which calls `autoClaimDiffReviewsIfUnheld` (`mcp.ts:283`). That function silently grants the claim to whichever MCP session calls first when no holder exists. A spawned claude on its first MCP call would auto-claim and stomp the user's interactive flow.

  Fix: `autoClaimDiffReviewsIfUnheld` checks `managedClaude.hasActiveJob(slug)` first; if true, skip. While any managed job for the slug is running, no auto-claim happens. After the job ends, normal auto-claim resumes. The user's own pre-existing claim is never touched (the function only acts when no holder exists).

  Side-benefit: managed-claude tools never claim, never receive channel notifications, never appear in the iterative-analysis spec's `connection-state` UI. They are invisible to the channel-notification system, which is what we want — channel notifications are for collaboration with the user's interactive claude, not for managed jobs.

  Skills invoked by managed claude (`/lgtm refresh`, `/lgtm walkthrough`, `/lgtm answer`) are unaffected: they don't call `claim_reviews` directly (verified in `skills/analyze/SKILL.md` and `skills/walkthrough/SKILL.md`), and the implicit auto-claim path is now suppressed for them by the supervisor flag.

### Replacing the existing channel-notification path

The `POST /project/:slug/comments` route (`server/app.ts`) currently has a `mode === 'direct' && !parentId` branch that calls `notifyChannel`. With managed claude, that branch is replaced:

```ts
// Before (today):
if (mode === 'direct' && !parentId) {
  notifyChannel(content, meta);
}

// After:
if (mode === 'direct' && !parentId) {
  enqueueJob(slug, 'comment-reply', comment.id);
}
```

The "Refresh analysis" button hook described in `iterative-analysis-design.md` (which was specified to call `notifyChannel`) similarly becomes `POST /project/:slug/jobs` with `kind='analysis'`. That spec's `POST /refresh-analysis` endpoint becomes redundant and is removed.

### UI components

New components in `frontend/src/components/managed-claude/`:

- **`RegenerateButton.tsx`** — generic button used wherever "regenerate this kind" is offered. Props: `kind`, `subjectId?`, `idleLabel`, `staleLabel`. Subscribes to `claude_job_status` for its key, renders the four states from the mockup (idle / stale / running / failed). On click, POSTs to `/jobs`. Shows the elapsed-time pill while running.
- **`ClaudeStreamPanel.tsx`** — collapsible log viewer. Used inline beneath a running or failed RegenerateButton. Renders the last-N lines from the job; subscribes to `claude_stream` for live updates while running.
- **`FirstOpenBanner.tsx`** — top-of-project banner. Three buttons trigger jobs; "Skip" calls `POST /banner-skip`. Disappears when an artifact lands or when `firstOpenBannerSkipped: true`.
- **`ProjectActivityDot.tsx`** — small dot in the project header. Subscribes to `claude_job_status` for any active job in this project; renders a pulse when something is running.

The existing comment-reply flow in `frontend/src/components/comments/CommentRow.tsx` extends to render the streaming claude reply when the parent has an active `comment-reply` job. Implementation: the row checks for any active managed job with `subjectId === comment.id`. If found, renders the live stream below. When the job completes, the actual reply comment lands via `comments_changed`, replacing the streaming view.

## Data model

### `managed_jobs` table

```sql
CREATE TABLE managed_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject_id TEXT,
  status TEXT NOT NULL,
  pid INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  exit_code INTEGER,
  failure_reason TEXT,
  last_lines TEXT  -- JSON array of {source, line}
);
CREATE INDEX idx_managed_jobs_lookup
  ON managed_jobs (project_slug, kind, subject_id, started_at DESC);
CREATE INDEX idx_managed_jobs_running
  ON managed_jobs (status, project_slug)
  WHERE status = 'running';
```

History is preserved (rows are not deleted on completion). "Current job for key" = most-recent row by `started_at` for that `(project_slug, kind, subject_id)`. "Is anything running" = scan the partial index. UI cleans up stale `succeeded` rows older than 7 days via a server-side housekeeping pass on startup; failed rows are kept indefinitely.

### Project metadata extension

The existing `projects` table is `(slug TEXT PRIMARY KEY, data TEXT NOT NULL)` — all per-project state already lives inside the `data` JSON blob (see `ProjectBlob` in `server/store.ts:6`). Add `firstOpenBannerSkipped: boolean` (default `false`) to `ProjectBlob`, plumbed through `Session.toBlob()` / `fromBlob()`. No schema migration required; missing field reads as `false`. The `GET /project/:slug` summary surfaces it directly.

### Comment shape

Unchanged on the persistence layer — the spawned claude's eventual reply lands as a regular `Comment` via `mcp__lgtm__reply`, no new fields. The live transcript shown during a running `comment-reply` job is **transient view-only state in the frontend**, derived from `claude_stream` SSE events, not persisted as a Comment. When the job completes and the reply Comment lands via `comments_changed`, the frontend swaps the streaming view for the persisted comment.

## Skill: `/lgtm answer`

A new skill at `skills/answer/SKILL.md`. Invoked as `/lgtm answer <commentId>`.

Steps:

1. Use a comment-fetch MCP tool — **introduce a new MCP tool `read_comment(commentId)`** that returns the comment record plus the file/line context it's anchored on. (The existing `read_feedback` tool returns submitted feedback only, not arbitrary comments.)
2. Read prior analysis via `read_analysis()` for project context. Read the file the comment is on for code context.
3. Compose a focused reply: addresses the question directly, no filler.
4. Call `mcp__lgtm__reply(commentId, text)` to post.

The `read_comment` MCP tool the skill depends on is specified in MCP changes above — the only MCP-surface addition in this spec.

## Frontend ergonomics

- **Trigger surfaces** in the UI:
  - Analysis tab header: `RegenerateButton kind="analysis"`.
  - Walkthrough tab header: `RegenerateButton kind="walkthrough"`.
  - Comment row with `mode='direct'`, no reply yet, AND no in-flight job for that comment: a "managed claude will reply shortly" subtle indicator. The actual job is enqueued by the server on comment creation; the UI just reflects state.
  - First-open banner: above the diff view when no analysis and no walkthrough exist.

- **Idle / stale / running / failed pill** on each `RegenerateButton`. Stale state pulls from the existing freshness data in `iterative-analysis-design.md` for analysis. For walkthrough, "stale" is "diff has advanced since last walkthrough" (deferred to walkthrough-refresh, future work; v0 walkthrough button shows just idle / running / failed).

- **Inline log viewer** appears below a `RegenerateButton` when state is `running` or `failed`. Collapses by default; user expands. Live-updates via `claude_stream`.

## Failure modes

| Failure | Detection | UI response |
|---|---|---|
| Spawn error (`claude` CLI not found, EACCES, etc.) | `child_process.spawn` error event | Failed pill, error message names the cause. Retry button enabled. |
| Non-zero exit | Process `close` event, `code !== 0` | Failed pill with exit code; expandable log shows last 200 lines including stderr. |
| Server restart while running | Boot-time recovery scan: any `status='running'` rows → `'failed'` with reason `server-restart` | Failed pill on next page load; user clicks Retry to re-enqueue. |
| Hung subprocess | Not detected. v0 punts. | User waits or restarts the server. Acknowledged in out-of-scope. |
| MCP-side error during the run (e.g. `set_analysis` fails) | Skill emits stderr; subprocess exits non-zero | Same path as non-zero exit. |
| Exit 0 but no artifact produced (model silently returned without calling `set_walkthrough` etc.) | For `analysis` and `walkthrough` jobs: snapshot artifact existence/identity (e.g., updated-at SHA pair) before/after the run; if unchanged on a successful exit, downgrade `succeeded` → `failed` with reason `no-artifact`. For `comment-reply`: similarly verify a child Comment with the right `parentId` was created. | Failed pill with "model returned without producing an artifact" message. Retry button enabled. |
| Spawned claude attempts to claim the slug | Suppressed by `autoClaimDiffReviewsIfUnheld` checking `managedClaude.hasActiveJob(slug)` first | Not possible during a managed run — see MCP changes section. |

## Testing

- **Unit (managed-claude.ts):** `enqueueJob` rejects when a running job exists for the same key for `analysis` / `walkthrough`. For `comment-reply`, rejects when ANY job (running, succeeded, or failed) exists for the same `(slug, commentId)`. `recoverFromCrash` flips running rows to failed. Last-lines ring buffer correctly caps at 200 entries with newest preserved.
- **Unit:** prompt rendering for each `JobKind` produces the right command string with `--permission-mode bypassPermissions`.
- **Unit (mcp.ts):** `autoClaimDiffReviewsIfUnheld` skips when `managedClaude.hasActiveJob(slug) === true`; auto-claims as before when `false`. Existing claims are never touched regardless.
- **Integration:** end-to-end `POST /project/:slug/jobs` with `kind='walkthrough'` against a real subprocess that exits successfully → row moves to `succeeded`, SSE events fire in order (`stream` lines, then `status` transition), walkthrough artifact lands.
- **Integration:** subprocess that exits non-zero → `failed` row with stderr captured; SSE `status` event carries the exit code.
- **Integration:** subprocess that exits 0 but produces no artifact → row downgraded to `failed` with reason `no-artifact`.
- **Integration:** comment with `mode='direct'` posted → server enqueues `comment-reply` job → spawned claude calls `mcp__lgtm__reply` → reply comment lands → `comments_changed` SSE fires. Verify the channel-notification path is no longer invoked for direct comments.
- **Integration:** double-`POST /comments` for the same `mode='direct'` comment (network-retry simulation) — only ONE `comment-reply` job is enqueued.
- **Integration:** managed claude run starts; concurrent MCP tool call from a separate "user" session — auto-claim is suppressed for the user session for the duration; resumes after the managed run completes.
- **Integration:** server killed mid-run, restarted → orphaned row recovered to `failed` state on boot.
- **Integration:** two `RegenerateButton` clicks on different kinds for the same project run concurrently. Two clicks on the same kind: first runs, second 409s.
- **Frontend (vitest):** `RegenerateButton` state machine driven by mock SSE events transitions correctly through idle → running → succeeded → idle (post-completion stable state). Failed-state expansion shows captured lines.

## Migration

No data migration. New table, new column on `projects`. Existing rows get the default `first_open_banner_skipped = 0`, which means new banners appear on existing projects — desired behavior; the user gets the new affordance.

The replacement of `app.ts:650-664` channel-notification path is a behavior change: any interactive claude that was relying on receiving the question notification will stop receiving it. This is intentional — UI buttons are the managed-claude surface, the user can still type in their interactive terminal. Communicate in release notes.

## Out-of-scope future work

- **Cancel a running job.** A "Stop" button on the running pill. Requires SIGTERM-then-SIGKILL handling, race-safe state transitions. Defer until users ask.
- **Hung-job detection.** Wallclock timeout (e.g., 5 min) with auto-kill. Defer; max-plan + manual server-restart is acceptable for v0.
- **Worktree-managed projects (cmd-K → PR #123).** Separate spec. Builds on this — a managed project IS a project with managed claude, plus a managed worktree.
- **Cost / token telemetry.** Surface tokens-per-run somewhere. Out of scope; max-plan covers the cost.
- **Per-project rate limit.** Defer. Acceptable to fire 100 jobs/day if the user wants to.
- **Walkthrough freshness.** Mirror analysis freshness so the walkthrough button can show a "stale" pill. Defer to a walkthrough-refresh spec.
- **Conversation context across runs.** Each run is fresh today. If users want "claude, building on what you said last time…" we'd thread prior runs into the prompt. Out for v0.
- **Restoring the iterative-analysis spec's "copy refresh prompt" fallback.** With managed claude the button is always enabled, so the fallback isn't needed. If managed-claude proves unreliable in practice, a fallback might come back — out of scope until then.

## Open questions

- **First implementation step is a smoke test.** Spawn `claude -p "/lgtm walkthrough" --permission-mode bypassPermissions` against a registered project and confirm: (a) it runs to completion non-interactively, (b) it does NOT auto-claim (after the supervisor's `hasActiveJob` suppression in `autoClaimDiffReviewsIfUnheld` is in place), (c) `set_walkthrough` writes the artifact. If the CLI flag name has drifted or the auto-claim suppression has a hole, surface immediately before building the supervisor on top.
