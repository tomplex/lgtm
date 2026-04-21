# LSP Integration — Diagnostics Overlay

> **Scope note.** This spec covers diagnostic rendering on diff lines for files touched by the current review. It depends on the LSP infrastructure defined in `2026-04-21-lsp-peek-features-design.md` (LspClient, LspManager, Session integration, URI construction, position encoding, error handling, status badges). Read that spec first — the architecture bits below build on it rather than restating it. Both specs must be approved before implementation begins.

## Background

Reviewers want to know whether a PR introduces new type errors, unused imports, or other static problems. Today there's no such signal in the diff view — the reviewer must either trust CI or check out the branch locally. With LSP infrastructure already landing for peek features (Spec A), diagnostics are a natural second surface: each LSP is already pushing `publishDiagnostics` notifications as files are opened; surfacing them inline in the diff is the bridge.

## Goals

- **Diagnostic underlines on diff lines** for files touched by the diff, with squiggly underlines over the exact reported range and the full message on hover.
- **Live updates** — when an LSP publishes a new or revised diagnostic for an open file, the diff view updates without the user reloading.
- **Same three languages** as Spec A: Python (ty), TypeScript (typescript-language-server), Rust (rust-analyzer). Other languages: no diagnostics.
- **Cooperative with peek features** — opening a file for diagnostics and opening it to satisfy a definition/hover/references request share the same `textDocument/didOpen` state.

## Non-goals

- **No whole-workspace diagnostics.** Only files appearing in the current diff. Pre-existing errors in unrelated files are not surfaced.
- **No diagnostics on the old/LHS side of the diff.** The worktree's on-disk state is the branch under review (HEAD). LSP diagnostics describe that state, not the pre-PR state.
- **No inline code-action suggestions ("did you mean X?" quickfix buttons).** Listed as a Spec A upgrade path; separate work if pursued.
- **No cross-session diagnostics caching.** State is process-memory only, matching Spec A.

## Per-language capability notes

| Feature | typescript-language-server | ty | rust-analyzer |
|---|---|---|---|
| `publishDiagnostics` on open | Full, fast (<1s) | Full, fast (<1s) | Full, slow (often 5–30s cold) |
| Incremental updates on save/change | Not applicable (worktree is static) | Not applicable | Not applicable |
| Diagnostic ranges (UTF-16) | Accurate | Accurate | Accurate |
| Severity levels | error / warning / info / hint | error / warning | error / warning / info / hint |

rust-analyzer's cold-start diagnostic lag is the architectural driver for the SSE approach below.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope | All lines in files touched by the diff, RHS only | Catches ripple effects within a changed file that a strictly-touched-lines scope would miss. |
| UI | Squiggly underline on reported range + full message on hover | Precise (shows *what* is wrong) without inline-text noise. |
| Delivery | SSE push, piggybacking on the existing SSE channel | Eliminates rust-analyzer's cold-start stale-cache problem; reuses infrastructure. |
| Open-file lifecycle | `didOpen` when the user opens a diff file; `didClose` when the Session evicts or the file is unloaded from the diff cache | Prevents leaked opens growing LSP memory without bound. |
| Large-file skip | Files >2MB are not opened for diagnostics; badge shows `"file-too-large"` status | Stops a single 5MB generated `.ts` from stalling typescript-language-server for every other file. |
| Severity filter | Errors + warnings rendered; info / hint suppressed | Review view is for decision-making, not style nits. Configurable later if needed. |
| Severity styling | Red squiggle for errors, yellow for warnings; same `title` tooltip mechanism | Matches conventional editor affordances. |

## Architecture

### Additions to Spec A's modules

- `server/lsp/client.ts`:
  - `openFile(uri)` and `closeFile(uri)` methods (Spec A already lists these in `LspClient`; Spec B activates their use for the diagnostics flow).
  - Per-URI diagnostics cache populated by `textDocument/publishDiagnostics` notifications: `Map<uri, Diagnostic[]>`.
  - New event emitter `onDiagnostics(uri, diagnostics)` that fires every time a `publishDiagnostics` notification arrives.
- `server/lsp/manager.ts`:
  - Exposes an aggregated `onDiagnostics(uri, diagnostics, language)` stream across all per-language clients.
- New file `server/lsp/diagnostics.ts`:
  - `DiagnosticsBroker` — holds the set of URIs the session considers "open for diagnostics" and wires `LspManager.onDiagnostics` events into the Session's SSE broadcaster.
  - Tracks per-URI status for the frontend: `"pending" | "ready" | "file-too-large" | "no-lsp"`.

### Session integration

`Session` gains:

- `session.lsp.diagnostics: DiagnosticsBroker` (the broker sits on the existing `LspManager`).
- On file-cache eviction (or session eviction), `closeFile(uri)` is called for every open URI. The existing diff-cache lifecycle is the hook point.

### SSE integration

Diagnostics ride the Session's existing SSE channel as a new event type:

```
event: diagnostics
data: {"file":"server/app.ts","diagnostics":[{"line":42,"character":8,"endLine":42,"endCharacter":16,"severity":"error","message":"..."}]}
```

The payload replaces the previous diagnostic set for that file — the client-side store does a wholesale swap keyed by file path, matching how comments are handled in `state.ts`.

A new REST endpoint returns the current snapshot for a file (for the first load / SSE reconnect):

| Method | Path | Purpose |
|---|---|---|
| GET | `/project/:slug/diagnostics?file=...` | Current diagnostic snapshot for `file`. May be empty if the LSP hasn't published yet — subsequent SSE events will update. |

Response shape: `{ diagnostics: Diagnostic[], status: "pending" | "ready" | "file-too-large" | "no-lsp" | "missing" | "crashed" }`.

### Frontend changes

- `diff.ts` `DiffLineType` gains an optional `diagnostics?: Diagnostic[]` field (diagnostic shape: `{line, character, endLine, endCharacter, severity, message}`).
- `DiffLine.tsx` renders, for each diagnostic:
  - A squiggly underline over the range specified by `(character, endLine, endCharacter)` relative to the line.
  - Severity-colored (error red, warning yellow) via CSS classes.
  - `title` attribute on the underlined span carries the `message` — hover shows the tooltip natively.
- Only RHS diff rows render diagnostics (additions and unchanged-RHS). LHS rows are ignored.
- `state.ts` gains a `diagnostics: Record<filePath, Diagnostic[]>` store, updated by SSE events and the initial fetch.
- Peek-features status badge (Spec A) gains a compound sub-state for files with `"file-too-large"` — shown when the current file is the one skipped, not as a global badge.

## Data flow

### Opening a file in the diff

1. User selects a file in the sidebar. `fetchItemData` loads the diff.
2. Backend checks the file size: if >2MB, set status `"file-too-large"` and return an empty diagnostics snapshot — no `openFile` call.
3. Otherwise, `DiagnosticsBroker` calls `LspManager.get(lang)?.openFile(uri)` (if not already open).
4. Backend returns the current snapshot from `LspClient`'s diagnostics cache immediately (possibly empty).
5. Frontend renders the diff with whatever diagnostics are in the snapshot (often zero on first open for rust-analyzer).
6. As the LSP publishes `publishDiagnostics` for that URI, `LspClient` updates its cache, fires `onDiagnostics`, the broker translates it to an SSE event, and the frontend updates live.

### Position-to-diff-row mapping

LSP diagnostics arrive as `{line, character, endLine, endCharacter}` in the file's RHS state. The diff renderer already knows each file's RHS line numbers per `DiffLine`. Mapping:

- For each diagnostic, find the `DiffLine` whose `newLine === diagnostic.line + 1` (LSP lines are 0-based; diff lines are 1-based). Multi-line diagnostic ranges map to multiple DiffLines.
- On that line, render an underlined `<span>` covering UTF-16 offsets `[character, endCharacter]` within the content cell.
- If the target RHS line doesn't exist in the displayed diff (e.g., line outside any hunk), the diagnostic is dropped — the diff viewer only shows hunks, and we don't expand them to surface an external diagnostic.

### Navigating away / closing the file

- When the user switches to another file in the sidebar, the previous file stays open with the LSP (diagnostic state continues to be maintained; minor memory cost).
- When the Session's diff cache evicts a file (or the Session itself is evicted), `closeFile(uri)` is called. `LspManager` forwards to the right `LspClient`; `LspClient` sends `textDocument/didClose` and evicts its diagnostics cache entry.

### Fallback

- `LspManager.get(lang) === null`: status `"no-lsp"`, empty diagnostics. The Spec A badge already surfaces the missing LSP at the language level.
- `LspClient` crashed: status `"crashed"`, empty diagnostics. Badge shows "crashed" per Spec A.
- File too large: status `"file-too-large"`, empty diagnostics, compound badge on that file only.

## Error handling

| Failure mode | Detection | Response |
|---|---|---|
| LSP never publishes diagnostics | No `publishDiagnostics` arrives after `openFile` | User sees an empty diagnostic set until/unless the LSP eventually pushes. No timeout needed — SSE keeps the channel open. Status stays `"pending"`. |
| Diagnostic range out of bounds | `line >= file_length` or `character > line_length` | Clamp to the valid range. Log the out-of-bounds diagnostic once for debugging. |
| Diagnostic targets a line outside any diff hunk | Computed at render time | Diagnostic is dropped silently. Not surfaced. |
| File too large | `fs.statSync(file).size > 2_000_000` at open time | Skip `openFile`. Status `"file-too-large"`. |
| `publishDiagnostics` race with `closeFile` | Notification arrives after `didClose` | Client ignores the notification for URIs not in the open set. |

## Testing

**Unit tests** (default suite, vitest):

- `server/__tests__/lsp/diagnostics.test.ts` — `DiagnosticsBroker` open/close lifecycle, SSE event construction, file-size skip, capability-missing handling.
- `server/__tests__/lsp/client-diagnostics.test.ts` — `LspClient` diagnostics cache populated by stubbed `publishDiagnostics` notifications, `onDiagnostics` event firing, cache eviction on `closeFile`.
- `server/__tests__/routes-diagnostics.test.ts` — `/diagnostics` endpoint response shapes including all status values.
- `server/__tests__/lsp/diagnostic-mapping.test.ts` — position-to-DiffLine mapping, including non-BMP characters, multi-line ranges, and out-of-hunk drops.

**Integration tests** (opt-in via `LSP_INTEGRATION=1`):

- `server/__tests__/lsp/integration-diagnostics-ty.test.ts` — spawn real ty against a fixture Python repo with a deliberate type error; assert a diagnostic appears with the expected range and severity.
- `server/__tests__/lsp/integration-diagnostics-rust.test.ts` — same for rust-analyzer, with a generous (>60s) timeout to accommodate cold `cargo check`.
- typescript-language-server follows the same pattern.

**Fixtures**: `server/__tests__/fixtures/lsp/{python,typescript,rust}/` (shared with Spec A) gains one file per language containing a deliberate diagnostic (one error, one warning).

**Frontend tests** (vitest):

- `DiffLine` renders squiggly spans over the right UTF-16 range for the given diagnostic.
- `diagnostics` store updates from SSE events, including replace-by-file semantics.
- Non-BMP characters in a line with a diagnostic don't misalign the underline.
- Out-of-hunk diagnostics don't render.

**Not tested**: `vscode-jsonrpc` wire behavior (Spec A covers this), the LSP binaries themselves.

## Upgrade path

- **Severity filter toggle** — add UI to include `info` / `hint` if reviewers find the current filter too strict.
- **Touched-lines-only toggle** — a switch that narrows scope from "all lines in touched files" to "lines added/modified by the diff". Useful if the whole-file scope proves noisy.
- **Diagnostic grouping** — when a file has many diagnostics, surface a count badge in the sidebar next to the filename.
- **Code actions / quickfix suggestions** — surface LSP `textDocument/codeAction` responses for a diagnostic, rendered as a "quick fix" button in the diagnostic tooltip.
- **Keep-open-on-navigate tuning** — currently we keep files open until Session evicts the diff cache. If LSP memory becomes a problem, switch to "close on navigate away" with a small LRU buffer.
