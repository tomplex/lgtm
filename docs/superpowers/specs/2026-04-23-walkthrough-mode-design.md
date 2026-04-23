# Walkthrough Mode

## Motivation

Tom is the bottleneck in his review loop. The tool already handles orientation, prioritization, and navigation well — the sidebar tree, analysis layer, and LSP peek features have closed those gaps. What remains slow is loading dense code into his head line by line. He reasons about system-level impact easily; the friction is in verifying the minute details of what each changed function actually does.

Existing comprehension aids (per-file analysis, priority labels, phase grouping) operate at the file level. There is nothing at the granularity where the comprehension cost actually lives: inside a hunk, across a logical change that may touch several files.

## Design overview

Walkthrough mode is a **reading lens** over the diff — a Claude-authored narrative tour through the substantive logical changes in a branch. A walkthrough consists of an ordered sequence of **stops**, each covering one logical change. A stop carries a short title, a narrative paragraph, and references to the code artifacts (hunks across one or more files) that implement it.

Walkthrough is a new view toggleable with the diff view. Comments and per-file "reviewed" marks are shared between the two views — one dataset, two lenses.

Walkthrough covers only substantive changes. Trivial hunks (formatting, pure renames, whitespace) are left for the diff view; completing the walkthrough is not the same as finishing review.

## Core concepts

**Stop.** One logical change authored as a narrative unit. Has a title, a narrative paragraph (~30–100 words), an importance tag (`primary` / `supporting` / `minor`), and one or more code artifacts. Stops are the atomic unit of the walkthrough.

**Artifact.** A reference to code belonging to a stop. An artifact points at a file and a set of hunk ranges within that file. A stop can have multiple artifacts (e.g., a stop that touches three files has three artifacts). An artifact may carry an optional inline narrative banner shown above it when rendered.

**Walkthrough.** The ordered collection of stops for a given diff, plus an opening summary paragraph. Tied to a specific diff hash — if the diff changes, the walkthrough becomes stale.

**Shared review state.** Comments, per-file reviewed marks, and the comment composer are the same model as the diff view. A comment authored in walkthrough mode appears on the corresponding diff line in diff view, and vice versa.

## User flow

1. User runs `/lgtm walkthrough` (or `/lgtm prepare` to chain analyze + walkthrough). Claude authors stops via the `set_walkthrough` MCP tool.
2. User opens the review in the browser. A "Walkthrough" button appears in the header, alongside existing controls.
3. User presses `W` (shift-w, since `w` is already bound to whole-file view) or clicks the button to enter walkthrough mode. The main reading area becomes the walkthrough view.
4. The walkthrough view shows: a stop list on the left (always visible), the current stop in the center (title, narrative, code artifacts), a header breadcrumb with progress, and keyboard-hint footer.
5. User navigates with `↵` / `⇧↵` (next / prev stop), `j` / `k` (within stop), or clicks a stop in the left rail. Comments work as in the diff view; `c` opens a composer attached to the focused line.
6. User presses `d` to return to the diff view. File rows in the sidebar carry a small badge indicating which stops cover files in that row, so the user can pivot from diff back into walkthrough at a specific stop.
7. User marks files as reviewed in whichever view they prefer; that state syncs.

## UI layout

The walkthrough view takes over the diff reading area when active. It has three regions:

- **Top bar.** `← Back to diff` on the left, the session's review title (same as diff view) in the center, "Stop N of M · NN%" progress on the right.
- **Left rail (220px, always visible).** Ordered stop list. Each row shows stop number, title, and sub-label listing the touched files. Active stop is highlighted with an accent border; visited stops are dimmed with a checkmark. A stop is marked visited automatically once it has been the active stop — no explicit "mark done" action.
- **Main column.** For the current stop: a small "Stop N · <importance>" label, the title, the narrative paragraph, then the code artifacts. Each artifact has a file header and the relevant hunks rendered with the same styling as the diff view. Inline narrative banners appear between artifacts where Claude has chosen to add connective tissue.
- **Bottom hints.** Keyboard shortcut reminders (`j/k` focus hunks, `↵`/`⇧↵` next/prev stop, `c` comment, `d` back to diff, `g<N>` jump to stop N).

Mockup reference: `.superpowers/brainstorm/*/content/walkthrough-view.html`

### Sidebar badges in diff view

File rows in the tree sidebar gain a small badge indicating walkthrough coverage (e.g., "◆ 3" meaning covered by stop 3, or "◆ 3,5" for multiple stops). Clicking the badge opens walkthrough mode at the indicated stop. Hunks themselves are not badged; the indicator lives only on file rows to keep the diff view uncluttered.

## Data model

A stop carries: `id`, `order` (1-based position), `title`, `narrative` (markdown), `importance` (`primary` | `supporting` | `minor`), and a list of `artifacts`.

An artifact carries: `file` path, a list of hunk references (by old/new line ranges), and an optional `banner` string.

A walkthrough carries: `id`, `sessionSlug`, `diffHash` (sha of the unified diff at generation time), `generatedAt` timestamp, `summary` paragraph, ordered `stops`, and a `stale` flag.

Hunk references are frozen snapshots of line ranges at generation time. If the diff changes, the walkthrough is marked stale and the references are no longer guaranteed to resolve cleanly — regeneration is the fix.

Persistence lives alongside the existing analysis tables in `~/.lgtm/data.db`. One walkthrough per session; regenerating replaces the previous walkthrough entirely.

## MCP surface

A new MCP tool, `set_walkthrough`, accepts the walkthrough payload (summary + ordered stops with artifacts). It replaces any existing walkthrough for the session. The existing `set_analysis` tool is unchanged.

Tools are independent so Claude can generate analysis, walkthrough, or both as separate calls without coupling them.

## Skill surface

- **`/lgtm analyze`** — existing; generates classification only.
- **`/lgtm walkthrough`** — new; generates walkthrough only. Runs independently of `/lgtm analyze` — either can exist without the other.
- **`/lgtm prepare`** — new convenience; chains `/lgtm analyze` then `/lgtm walkthrough`.

Skills call the appropriate MCP tools; orchestration lives in the skill layer, not in the server.

## Staleness and invalidation

A walkthrough's `diffHash` is compared against the current diff on load. If they differ, the walkthrough is rendered in a "stale" state:

- A persistent banner at the top of the walkthrough view: "Walkthrough out of date — diff has changed since generation. Run `/lgtm walkthrough` to refresh."
- Hunk references are rendered best-effort. If a reference can't resolve (the lines no longer exist), the artifact shows a small "code moved or removed" placeholder in place of the hunk body.
- The user can still read the stale walkthrough; nothing auto-deletes.

Regeneration is explicit via the skill, never automatic on diff change.

## Empty state

Pressing `W` or clicking the Walkthrough button when no walkthrough exists shows a placeholder in the main column: "No walkthrough generated yet. Run `/lgtm walkthrough` (or `/lgtm prepare` to also analyze) to build one." The sidebar tree and other UI remain as they are; the walkthrough mode simply has no content to show.

## Out of scope for this spec

To keep the first cut focused, the following are explicitly deferred:

- **Total coverage.** The walkthrough is not required to cover every hunk. Housekeeping-only meta-stops are not generated.
- **Live Q&A about a stop.** The conversational sidebar direction from earlier brainstorming is a separate future feature, not bundled here.
- **Executable diffs / inline test output.** A separate concern.
- **Walkthrough chapters / nested stops.** Stops are a flat ordered list.
- **Per-hunk badges in diff view.** Coverage indicators live only on file rows.
- **Multi-walkthrough.** One walkthrough per session; alternative orderings or competing walkthroughs are not supported.
- **Resilient hunk references across diff changes.** Stale walkthroughs degrade gracefully but do not re-anchor; regeneration is the fix.

## Success criteria

A successful walkthrough mode makes a dense review *feel* faster in the minute-detail phase:

- Tom can enter walkthrough mode, read a stop, confirm the code matches the narrative, and advance — without leaving the keyboard.
- Commenting from walkthrough mode works identically to diff mode and posts to the same thread.
- Toggling between walkthrough and diff is instant and preserves each view's state independently.
- When the diff changes, the staleness signal is obvious and actionable.
