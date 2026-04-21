# LSP Integration

## Background

`server/symbol-lookup.ts` uses language-aware ripgrep patterns to resolve symbols for the PeekPanel. It works, but it's a regex over file content — it can't follow imports, distinguish precisely between similarly-named symbols, find methods on classes, surface call sites, or report type errors. The `2026-04-02-peek-definition-design.md` spec explicitly flagged a tree-sitter / LSP upgrade path as the follow-on.

This spec covers that upgrade: a real Language Server Protocol client for Python, TypeScript, and Rust, with ripgrep as the fallback for every other language. The change is scoped to the human review UI — a separate refactor MCP tool, developed in parallel, handles Claude's side of LSP access.

## Goals

- **Go-to-definition** that resolves imports and class members correctly for Python / TS / Rust, replacing the regex fallback when an LSP is available for the file's language.
- **Hover** content (type, signature, docs) surfaced in the PeekPanel header.
- **Find-references** workspace-wide, rendered as an inline list below the definition in the PeekPanel.
- **Diagnostics on diff lines** for files touched by the current diff, rendered as a squiggly underline over the reported range with the full message on hover.
- **Ripgrep fallback** for anything outside the three supported languages, or when an LSP binary is missing / crashed / timed out.

## Non-goals

- **No MCP surface.** LSP-via-MCP is handled by a separate tool.
- **No whole-workspace diagnostics.** Diagnostics are only fetched for files appearing in the current diff. Pre-existing errors in unrelated files are not surfaced.
- **No auto-install.** The user installs ty / typescript-language-server / rust-analyzer through their own package managers. The tool detects absence and falls back silently, with a subtle status badge.
- **No LSP restart-on-crash.** v1 marks a crashed client "crashed" and stays on fallback until the session restarts — avoids crash loops.
- **No tooltip-on-mouseover.** Hover info lives in the PeekPanel header only (gesture-triggered via Cmd+click), not as a floating tooltip over raw code.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Languages | Python (ty), TS/JS (typescript-language-server), Rust (rust-analyzer) | Three primary languages in this project. Others use ripgrep. |
| LSP client library | `vscode-languageserver-protocol` + `vscode-jsonrpc` | Typed handlers for every LSP method reduce bug surface across four features. Used by VS Code itself. |
| Consumer surface | Frontend only | MCP handled separately. |
| Diagnostic scope | All lines in files touched by the diff | Catches ripple effects within a changed file that a strictly-touched-lines scope would miss. |
| Find-references UI | Inline list below definition in PeekPanel | Single panel, one scroll — no tab-switching. |
| Hover UI | PeekPanel header enhancement | Matches the existing gesture model; no tooltip plumbing. |
| Diagnostics UI | Squiggly underline on reported range + hover for message | Precise (shows *what* is wrong) without inline-text visual noise. |
| LSP lifecycle | One client per (project path, language), lazy-init on first request, owned by Session | Matches session-manager's per-project-path keying; worktrees isolate naturally. |
| First-query UX | PeekPanel shows "Indexing…" during cold start, respects per-language timeout | Simpler than a poll loop; LSPs publish ready signals we can block on. |
| Language detection | By file extension at request site | Workspace-level detection adds complexity with no benefit here. |
| Missing binary UX | Silent ripgrep fallback + subtle status badge | Personal tool; loud notifications are unnecessary. |

## Architecture

New module tree:

```
server/lsp/
  client.ts        LspClient — one spawned LSP, stdio JSON-RPC via vscode-jsonrpc
  manager.ts       LspManager — owns LspClients for one Session, lazy per language
  languages.ts     extensionToLanguage(), per-language command/args/init-options
  types.ts         Local result shapes (Definition, Hover, Reference, Diagnostic)
  index.ts         Re-exports
```

`server/symbol-lookup.ts` is untouched. It remains the implementation of the existing `/symbol` (name-search) endpoint and the fallback for `/definition`.

### LspClient

Wraps one `child_process.spawn()` of an LSP binary. Composed with `vscode-jsonrpc` for transport. Responsibilities:

- Initialize handshake: send LSP `initialize` with `rootUri: file://<projectPath>` and capability set declaring `textDocument/definition`, `hover`, `references`, `publishDiagnostics`. Send `initialized` notification.
- Track lifecycle state: `initializing` → `indexing` → `ready` → (`crashed` | `shuttingDown`). For rust-analyzer, wait for the `rust-analyzer/status` notification reaching `"quiescent"` before flipping to `ready`. For ty and tsserver, flip immediately after `initialized`.
- Methods: `definition(uri, pos)`, `hover(uri, pos)`, `references(uri, pos)`, `openFile(uri)` (sends `textDocument/didOpen` so the server starts publishing diagnostics), `getDiagnostics(uri)` (returns the cached snapshot for that URI).
- Per-file diagnostics cache populated by the LSP's `textDocument/publishDiagnostics` notifications.
- Stderr ring buffer (last 100 lines) for debugging.
- Graceful shutdown: `shutdown` → `exit` → wait 2s → SIGTERM → wait 3s → SIGKILL.

### LspManager

One instance per `Session`. Responsibilities:

- `get(language)` — returns an `LspClient` for that language, spawning lazily on first call. Returns `null` permanently if the binary for that language is missing (ENOENT on spawn).
- Request deduplication: concurrent identical `(method, file, line, character)` requests share one in-flight promise.
- Shutdown: kills every child on session eviction.

### Session integration

`Session` gains an `lsp: LspManager` field. `session-manager.ts` calls `session.lsp.shutdown()` during eviction. Persistence layer untouched — LSP state is process-memory only.

### New endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/project/:slug/definition?file=...&line=...&character=...` | Go-to-definition. Falls back to `findSymbol` if LSP unavailable. |
| GET | `/project/:slug/hover?file=...&line=...&character=...` | Hover content for PeekPanel header. |
| GET | `/project/:slug/references?file=...&line=...&character=...` | Reference list, capped at 50 with "show more". |
| GET | `/project/:slug/diagnostics?file=...` | Current diagnostics for a diff-touched file. |
| GET | `/project/:slug/lsp/debug` | Stderr ring buffer + recent requests, per language. Debug only, no UI link. |

Existing `/symbol?name=...` retains current behavior (doubleshift palette) — not rerouted through LSP. Workspace-wide symbol search is out of scope for v1.

### Frontend changes

- `PeekPanel.tsx`: header gains hover fields (type, signature, docs); body gains an inline References list below the existing definition code.
- `DiffLine.tsx`: renders a squiggly underline over diagnostic ranges via a CSS class; `title` attribute supplies the message on hover.
- New `lspStatus: Record<Language, "ok" | "missing" | "indexing" | "crashed">` signal in `state.ts`, updated from status hints included in each LSP-backed endpoint response (`{ result, status }`).
- New header status badge showing the current per-language LSP state when non-ok.

## Data flow

### Cold start (first LSP request for a language, per Session)

1. Frontend hits `/definition` (or hover/references/diagnostics).
2. `LspManager.get(language)` sees no client, spawns the binary with `cwd: projectPath`.
3. Client sends `initialize` + `initialized`. State: `initializing`.
4. For rust-analyzer, block on `rust-analyzer/status` → `"quiescent"`. For ty/tsserver, proceed immediately.
5. Per-language initialize timeout: 60s for rust-analyzer, 10s for ty/tsserver.
6. Once ready, the original request proceeds. The endpoint returns once the LSP responds (no separate "indexing" polling loop — the frontend shows a spinner in the PeekPanel while the request is outstanding).

### Go-to-definition

Frontend extends its Cmd+click handler to capture the character offset under the click event. `/definition?file=...&line=...&character=...` maps to LSP `textDocument/definition`. Server translates returned Locations into the existing `SymbolResult` shape by reusing body/docstring extraction helpers from `symbol-lookup.ts`. PeekPanel receives the result in its current format — no client shape change for the core definition payload.

### Hover

PeekPanel fires `/hover` in parallel with `/definition`. Response: `{ signature, type?, docs? }`. Header renders these above the existing file:line location. If hover is slow or fails, header renders without them — non-blocking.

### Find-references

PeekPanel fires `/references` in parallel. Response: `Array<{file, line, snippet}>`, initial cap 50 with "show more" affordance. Renders as an inline list below the definition code.

### Diagnostics

When `fetchItemData` loads a diff file, the backend calls `LspManager.get(lang)?.openFile(uri)` (if not already open), waits up to 1 second for the first `publishDiagnostics` notification for that URI, then returns the cached snapshot. The grace window is short because a worktree's on-disk state doesn't change mid-review — once the LSP converges, diagnostics are stable. If the LSP hasn't published yet when the window expires, the endpoint returns whatever is cached (possibly empty); a subsequent request for the same file will see the updated cache. Frontend merges each diagnostic into the corresponding `DiffLineType` (only lines on the new/HEAD side of the diff — the on-disk state is what the LSP sees). `DiffLine` renders the squiggly underline via the reported range.

### Fallback

Any `LspManager.get(lang) === null` or any `LspClient` method rejection routes to:

- `/definition` → `findSymbol()` — same `SymbolResult[]` shape, PeekPanel is none the wiser.
- `/hover`, `/references`, `/diagnostics` → empty results.
- `lspStatus[language]` flips to `"missing"` or `"crashed"`, badge appears.

## Error handling

| Failure mode | Detection | Response |
|---|---|---|
| Binary missing | `spawn` emits `error` with `ENOENT` | `LspManager.get(lang)` returns `null` permanently this session. Logged once. Badge: "missing". |
| LSP crashes mid-session | `child.on('exit')` nonzero | Client state `crashed`. In-flight requests rejected. No auto-restart in v1. Badge: "crashed". |
| Request timeout | Per-method deadline: definition/hover/refs 5s, diagnostics 10s, initialize 60s (rust-analyzer) / 10s (ty/tsserver) | Reject with `LspTimeoutError`. Caller falls back. Client stays alive. |
| Indexing never completes | Initialize-timeout path above | Badge stays "indexing". Same fallback. |
| Protocol/parse error | `vscode-jsonrpc` reject | Logged with full body. Treated as timeout. |
| Request during shutdown | Manager `shuttingDown` flag | Reject with `LspShuttingDownError`. No spawn, no fallback. |
| Unknown URI | LSP returns empty or specific error | Empty result / definition falls back. |
| Concurrent identical requests | Dedup by `(method, file, line, character)` | Share one promise. Prevents thundering-herd on hover-on-scroll. |

Stderr ring buffer exposed via `/lsp/debug` for when something breaks.

## Testing

Vitest + supertest, matching `server/__tests__/` conventions.

**Unit tests** (default suite):

- `server/__tests__/lsp/manager.test.ts` — spawn dedupe, lazy init, language routing, shutdown discipline. Stubbed `LspClient` factory.
- `server/__tests__/lsp/client.test.ts` — initialize flow, request dedup, timeout rejection, crash handling, stderr ring buffer. Stubs `vscode-jsonrpc` at the transport seam.
- `server/__tests__/routes-lsp.test.ts` — `/definition`, `/hover`, `/references`, `/diagnostics` happy paths with a mock `LspManager`. Critically, verifies `/definition` falls through to `findSymbol` when the manager returns `null`.
- `server/__tests__/lsp/languages.test.ts` — `extensionToLanguage` mapping.

**Integration tests** (opt-in via `LSP_INTEGRATION=1`):

- `server/__tests__/lsp/integration-ty.test.ts` — spawn real ty against a Python fixture repo (function with a type error, cross-file reference). Exercises definition, hover, references, diagnostics end-to-end.
- Rust-analyzer and tsserver integration tests follow the same pattern. Skipped by default — these catch protocol drift, not behavior.

**Fixtures**: `server/__tests__/fixtures/lsp/{python,typescript,rust}/` — ~3 files per language, each with a deliberate diagnostic and a cross-file reference.

**Frontend tests** (vitest in `frontend/src/__tests__/`):

- PeekPanel with hover/refs fields populated vs empty, with indexing state.
- DiffLine squiggly rendering for given `{line, character, endLine, endCharacter}`.
- `lspStatus` signal drives the header badge correctly.

**Not tested**: `vscode-jsonrpc` wire behavior, the LSP binaries themselves, full diff-viewer with diagnostics (covered by DiffLine + existing diff tests).

## Upgrade path

- **Restart-on-crash**: add a simple backoff-gated restart in v2 once crash modes are better understood.
- **Workspace symbol search**: route `/symbol?name=...` through LSP `workspace/symbol` when available, ripgrep otherwise. Doubleshift palette gains LSP-quality results.
- **Code actions / quick fixes**: surface fix suggestions for diagnostics via `textDocument/codeAction`. Natural fit once diagnostics UI is in place.
- **Diagnostics-on-touched-lines-only toggle**: add a UI toggle if the "whole file" scope proves noisy in practice.
