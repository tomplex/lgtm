# LSP Integration — Peek Features

> **Scope note.** This spec covers the LSP client infrastructure and three peek-driven features: go-to-definition, hover, and find-references. A companion spec, `2026-04-21-lsp-diagnostics-design.md`, covers the diagnostics overlay on diff lines and depends on the infrastructure described here. Both specs must be approved before implementation begins.

## Background

`server/symbol-lookup.ts` uses language-aware ripgrep patterns to resolve symbols for the PeekPanel. It works, but it's a regex over file content — it can't follow imports, distinguish precisely between similarly-named symbols, find methods on classes, or surface call sites. The `2026-04-02-peek-definition-design.md` spec explicitly flagged a tree-sitter / LSP upgrade path as the follow-on. This is that upgrade.

## Goals

- **Go-to-definition** that resolves imports and class members correctly for Python / TS / Rust, replacing the regex fallback when an LSP is available for the file's language.
- **Hover** content (type, signature, docs) surfaced in the PeekPanel header.
- **Find-references** workspace-wide, rendered as an inline list below the definition in the PeekPanel, where the LSP supports it.
- **Ripgrep fallback** for anything outside the three supported languages, or when an LSP binary is missing / crashed / timed out / lacks the capability.

## Non-goals

- **No diagnostics.** Deferred to the diagnostics spec.
- **No MCP surface.** LSP-via-MCP is handled by a separate refactor tool under parallel development.
- **No auto-install.** The user installs ty / typescript-language-server / rust-analyzer through their own package managers. Absence is detected and falls back silently with a subtle status badge.
- **No LSP restart-on-crash.** v1 marks a crashed client "crashed" and stays on fallback until the session restarts. Avoids crash loops.
- **No tooltip-on-mouseover.** Hover info lives in the PeekPanel header only (gesture-triggered via Cmd+click), not as a floating tooltip over raw code.
- **No workspace symbol search.** The existing `/symbol?name=...` (doubleshift palette) route stays on ripgrep for v1.

## Terminology

- **typescript-language-server** (the npm package / LSP wrapper). Not to be confused with TypeScript's internal "tsserver", which speaks a proprietary protocol. All references to the TS LSP in this spec mean the LSP-wrapper binary.
- **ty** — Astral's Python type checker and language server (beta as of April 2026, 1.0 targeted for 2026).
- **rust-analyzer** — the Rust LSP.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Languages | Python (ty), TS/JS (typescript-language-server), Rust (rust-analyzer) | Three primary languages in this project. Others use ripgrep. |
| LSP client library | `vscode-languageserver-protocol` + `vscode-jsonrpc` | Typed handlers for every LSP method reduce bug surface across three features. Used by VS Code itself. |
| Consumer surface | Frontend only | MCP handled separately. |
| Find-references UI | Inline list below definition in PeekPanel | Single panel, one scroll — no tab-switching. |
| Hover UI | PeekPanel header enhancement | Matches the existing gesture model; no tooltip plumbing. |
| LSP lifecycle | One client per (project path, language), lazy-init on first request, owned by Session | Matches session-manager's per-project-path keying; worktrees isolate naturally. |
| First-query UX | PeekPanel shows spinner with elapsed time; status transitions come from LSP notifications, not polling | Simpler than a poll loop; LSPs publish ready signals we can block on. |
| Language detection | By file extension at request site | Workspace-level detection adds complexity with no benefit here. |
| Missing binary UX | Silent ripgrep fallback + subtle status badge | Personal tool; loud notifications are unnecessary. |
| Position encoding | UTF-16 code units (LSP default) | rust-analyzer supports utf-8 but typescript-language-server does not; UTF-16 is the interoperable choice. |
| Request cancellation | `$/cancelRequest` when a PeekPanel closes or a new Cmd+click supersedes an in-flight request | Prevents rust-analyzer request queues from draining minutes of stale work. |

## Per-language capability assumptions

LSP support is uneven. Each server declares capabilities in its `initialize` response — we honor those declarations at runtime rather than assuming. Expected baseline as of April 2026:

| Feature | typescript-language-server | ty | rust-analyzer |
|---|---|---|---|
| Go-to-definition | Full | Full | Full |
| Hover | Full | Full | Full |
| Find-references | Full | Partial (beta; may return empty for cross-module refs) | Full |
| `experimental/serverStatus` (indexing signal) | n/a | n/a | Yes (opt-in capability) |

When an LSP declines a capability or returns empty, the feature renders its "no results" state. The status badge surfaces a `partial` state when we detect a capability was declined.

## Architecture

### Module tree

```
server/lsp/
  client.ts        LspClient — one spawned LSP, stdio JSON-RPC via vscode-jsonrpc
  manager.ts       LspManager — owns LspClients for one Session, lazy per language
  languages.ts     extensionToLanguage(), per-language command/args/init-options
  uri.ts           URI construction (pathToFileURL) and path normalization
  types.ts         Local result shapes (Definition, Hover, Reference)
  index.ts         Re-exports
```

`server/symbol-lookup.ts` is untouched. It remains the implementation of the existing `/symbol` name-search endpoint and the fallback for `/definition`.

### LspClient

Wraps one `child_process.spawn()` of an LSP binary. Composed with `vscode-jsonrpc` for transport.

**Responsibilities:**

- **Initialize handshake.** Sends LSP `initialize` with:
  - `rootUri: pathToFileURL(projectPath).href`
  - `capabilities.general.positionEncodings: ['utf-16']`
  - `capabilities.textDocument.{definition,hover,references}` all `{ dynamicRegistration: false }`
  - For rust-analyzer: `capabilities.experimental = { serverStatusNotification: true }` so the server pushes `experimental/serverStatus` notifications with `{ health, quiescent, message }`.
  - For rust-analyzer: `initializationOptions.check.targetDir = true` (isolated per-worktree target dir) to prevent concurrent reviews of the same Rust repo across worktrees from fighting over `target/` locks.
  - Then sends `initialized` notification.
- **Lifecycle state.** `initializing` → `indexing` → `ready` → (`crashed` | `shuttingDown`). For rust-analyzer, the `indexing → ready` transition fires when `experimental/serverStatus` arrives with `quiescent: true`. For ty and typescript-language-server, fire immediately after `initialized`.
- **Methods:**
  - `definition(uri, pos)` → LSP `textDocument/definition`
  - `hover(uri, pos)` → LSP `textDocument/hover`
  - `references(uri, pos)` → LSP `textDocument/references`
  - `openFile(uri)` → LSP `textDocument/didOpen` (for servers that require it before a request will resolve)
  - `closeFile(uri)` → LSP `textDocument/didClose` (mandatory balance — leaking opens grows rust-analyzer memory without bound)
  - `cancel(requestId)` → LSP `$/cancelRequest`
  - `shutdown()` → graceful termination
- **Request dedup.** Per-method key:
  - definition/hover/references: `(method, uri, line, character)`
  - openFile/closeFile: `(method, uri)`

  Concurrent identical in-flight requests share one promise.
- **Stderr ring buffer** (last 100 lines) for debugging.
- **Graceful shutdown.** Sends `shutdown` + `exit`, waits 2s → SIGTERM → waits 3s → SIGKILL.

### LspManager

One instance per `Session`. Responsibilities:

- `get(language)` — returns an `LspClient` for that language, spawning lazily on first call. Returns `null` permanently if the binary for that language is missing (ENOENT on spawn).
- Shutdown: kills every child on session eviction.
- Tracks per-language status (for the frontend badge): `{ language: "ok" | "indexing" | "missing" | "crashed" | "partial" }`.

### Session integration

`Session` gains an `lsp: LspManager` field. `session-manager.ts` calls `session.lsp.shutdown()` during eviction. Persistence layer untouched — LSP state is process-memory only.

### URI construction

All URIs sent to LSPs are produced via Node's `url.pathToFileURL(absPath).href`. All URIs received from LSPs go through `url.fileURLToPath()` before being used as filesystem paths. This handles encoding of spaces, unicode, and platform path separators automatically.

**Worktree subtlety:** In a Git worktree, the worktree's `.git` is a **file** containing `gitdir: ...` rather than a directory. Some LSPs sniff for a `.git/` directory to locate the workspace root. rust-analyzer uses the location of `Cargo.toml` for its workspace root, not `.git`, so this works. For ty and typescript-language-server, `rootUri` is what we send, and they trust it; no git-dir sniffing involved.

**Symlinks:** rust-analyzer canonicalizes symlinked paths; typescript-language-server preserves the symlinked form. When matching LSP-returned locations with the caller's view, normalize both sides via `fs.realpathSync` before comparing. Preserve the caller's original path form in the response shape so the PeekPanel displays the path the user clicked, not its resolved target.

### Position encoding

LSP character offsets are **UTF-16 code units**. The client advertises `positionEncodings: ['utf-16']`. The frontend produces `character` offsets from click events by:

1. Determining the character index under the click event within the **rendered source line** (not the highlighted HTML).
2. Converting to UTF-16 code units via `line.substring(0, index).length` (JS strings are UTF-16 internally, so this is direct).
3. Sending `{line, character}` to the backend, which passes it through.

Non-BMP characters (emoji, some CJK) take 2 code units — this is correct and interoperable.

### New endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/project/:slug/definition?file=...&line=...&character=...` | Go-to-definition. Falls back to `findSymbol` if LSP unavailable. |
| GET | `/project/:slug/hover?file=...&line=...&character=...` | Hover content for PeekPanel header. |
| GET | `/project/:slug/references?file=...&line=...&character=...` | Reference list; backend returns all results, frontend displays first 50 with "show more". |
| GET | `/project/:slug/lsp/debug` | Stderr ring buffer + recent requests, per language. Debug only, no UI link. |

Each LSP-backed response includes a `status` field alongside the result: `{ result, status: "ok" | "indexing" | "fallback" | "partial" | "missing" }`. Frontend updates the per-language `lspStatus` signal from this.

Existing `/symbol?name=...` retains current behavior (doubleshift palette).

### Frontend changes

- `PeekPanel.tsx`: header gains hover fields (type, signature, docs); body gains an inline References list below the existing definition code.
- Cmd+click handler extends to capture click offset within the rendered source line and send it as `character`.
- Peek close or supersession cancels outstanding requests. Implementation choice: the server maintains an in-flight-request registry keyed by a client-provided request ID, and the frontend hits a `DELETE /project/:slug/lsp/request/:id` endpoint on supersession.
- New `lspStatus: Record<Language, "ok" | "missing" | "indexing" | "crashed" | "partial">` signal in `state.ts`, updated from the `status` field in each LSP-backed endpoint response.
- New header status badge showing the current per-language LSP state when non-ok. Badge for `indexing` displays elapsed seconds since spawn.

## Data flow

### Cold start (first LSP request for a language, per Session)

1. Frontend hits `/definition` (or hover/references).
2. `LspManager.get(language)` sees no client, spawns the binary with `cwd: projectPath`.
3. Client sends `initialize` with the capability set above, then `initialized`. State: `initializing` → `indexing`.
4. For rust-analyzer, block on `experimental/serverStatus` with `quiescent: true`. For ty / typescript-language-server, proceed immediately after `initialized`.
5. Per-language initialize timeout, configurable, defaulting to:
   - rust-analyzer: **180s** (cold `cargo check` routinely takes 90–180s on medium crate graphs)
   - typescript-language-server: **15s** (tight for large monorepos with project references; bump via config if needed)
   - ty: **10s** (fast by design)
6. Once ready, the original request proceeds. The endpoint returns once the LSP responds. The frontend shows a spinner in the PeekPanel with the elapsed seconds.

### Go-to-definition

Frontend extends its Cmd+click handler to capture the UTF-16 character offset under the click. `/definition?file=...&line=...&character=...` maps to LSP `textDocument/definition`. Server translates returned `Location`(s) into the existing `SymbolResult` shape by reusing body/docstring extraction helpers from `symbol-lookup.ts`. PeekPanel receives the result in its current format — no client shape change for the core definition payload.

### Hover

PeekPanel fires `/hover` in parallel with `/definition`. Response: `{ signature, type?, docs? }`. Header renders these above the existing file:line location. If hover is slow or fails, header renders without them — non-blocking.

### Find-references

PeekPanel fires `/references` in parallel. Response: `Array<{file, line, snippet}>`. Renders as an inline list below the definition code, showing the first 50 with a "show more" control for the remainder.

### Fallback

Any `LspManager.get(lang) === null` or any `LspClient` method rejection routes to:

- `/definition` → `findSymbol()` — same `SymbolResult[]` shape, PeekPanel is none the wiser. Response status: `"fallback"` or `"missing"`.
- `/hover`, `/references` → empty results. Response status: `"missing"` / `"fallback"` as appropriate.
- `lspStatus[language]` flips to `"missing"` or `"crashed"`, badge appears.

### Cancellation

A new PeekPanel open cancels the previous peek's outstanding requests via `$/cancelRequest`. PeekPanel close cancels all of the current peek's outstanding requests. Cancellation is fire-and-forget — if the LSP has already responded, the cancel is a no-op.

## Error handling

| Failure mode | Detection | Response |
|---|---|---|
| Binary missing | `spawn` emits `error` with `ENOENT` | `LspManager.get(lang)` returns `null` permanently this session. Logged once. Badge: "missing". |
| LSP crashes mid-session | `child.on('exit')` nonzero | Client state `crashed`. In-flight requests rejected. No auto-restart in v1. Badge: "crashed". |
| Request timeout | Per-method deadline: definition/hover/refs 5s; initialize configurable (defaults above) | Reject with `LspTimeoutError`. Caller falls back. Client stays alive. |
| Indexing never completes | Initialize-timeout path above | Badge stays "indexing" until timeout, then falls back. Client marked "crashed" if the LSP process is wedged. |
| Protocol/parse error | `vscode-jsonrpc` reject | Logged with full body. Treated as timeout. |
| Request during shutdown | Manager `shuttingDown` flag | Reject with `LspShuttingDownError`. No spawn, no fallback. |
| Unknown URI | LSP returns empty or specific error | Empty result / definition falls back. |
| Concurrent identical requests | Dedup per-method key (above) | Share one promise. |
| Capability declined | LSP `initialize` response omits the capability | Endpoint short-circuits to empty result without calling LSP; badge status `"partial"`. |

Stderr ring buffer exposed via `/lsp/debug` for when something breaks.

## Testing

Vitest + supertest, matching `server/__tests__/` conventions.

**Unit tests** (default suite):

- `server/__tests__/lsp/manager.test.ts` — spawn dedupe, lazy init, language routing, shutdown discipline. Stubbed `LspClient` factory.
- `server/__tests__/lsp/client.test.ts` — initialize flow, capability-set construction, request dedup, timeout rejection, crash handling, cancellation, stderr ring buffer. Stubs `vscode-jsonrpc` at the transport seam.
- `server/__tests__/lsp/uri.test.ts` — `pathToFileURL` / `fileURLToPath` round-trips with spaces, unicode, and symlinks.
- `server/__tests__/lsp/languages.test.ts` — `extensionToLanguage` mapping and per-language init-option construction.
- `server/__tests__/routes-lsp.test.ts` — `/definition`, `/hover`, `/references` happy paths with a mock `LspManager`. Critically, verifies `/definition` falls through to `findSymbol` when the manager returns `null`, and that capability-declined paths short-circuit without calling the LSP.

**Integration tests** (opt-in via `LSP_INTEGRATION=1`):

- `server/__tests__/lsp/integration-ty.test.ts` — spawn real ty against a Python fixture repo. Exercises definition, hover, references end-to-end.
- Rust-analyzer and typescript-language-server integration tests follow the same pattern. The rust-analyzer test has a relaxed timeout and asserts on the `experimental/serverStatus` quiescent path. Skipped by default — these catch protocol drift, not behavior.

**Fixtures**: `server/__tests__/fixtures/lsp/{python,typescript,rust}/` — ~3 files per language, each with a cross-file reference. No diagnostic fixtures here (those live in the diagnostics spec).

**Frontend tests** (vitest in `frontend/src/__tests__/`):

- PeekPanel with hover/refs fields populated vs empty, with indexing state and elapsed timer.
- `lspStatus` signal drives the header badge correctly across `ok`, `indexing`, `missing`, `crashed`, `partial`.
- Cmd+click → character-offset computation for lines containing non-BMP characters.

**Not tested**: `vscode-jsonrpc` wire behavior, the LSP binaries themselves.

## Upgrade path

- **Restart-on-crash**: add backoff-gated restart in v2 once crash modes are understood.
- **Workspace symbol search**: route `/symbol?name=...` through LSP `workspace/symbol` when available, ripgrep otherwise. Doubleshift palette gains LSP-quality results.
- **Code actions / quick fixes**: surface fix suggestions via `textDocument/codeAction`. Natural fit once diagnostics ships.
- **SSE-pushed hover / references**: currently all LSP responses flow through REST. Long-running references on huge codebases could stream results over SSE. Not needed for v1.
