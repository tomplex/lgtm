# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-05-18

### Added

- `/lgtm analyze` accepts an optional focus area (as skill arguments or stated conversationally, e.g. "analyze, I only care about the migration"). The file-classifier gives in-scope files full attention and rubber-stamps the rest with an "Outside requested focus." note; the synthesizer leads the overview, strategy, and groups with the focused changes.
- Commit panel has a filter input — narrows the commit list by substring match against sha, message, author, and date. "Select all" / "Select none" act on the filtered subset.
- Embedded mode: `?embedded=1` hides project chrome for embedding in iframes; `?item=ID` deep-links to a specific file or document on load.
- "Submit to GitHub PR" is now always visible in the submit dropdown — disabled with a tooltip when no PR is detected (or when on a non-diff view). The tooltip surfaces the specific `gh` failure reason ("gh CLI not installed", SAML enforcement error, etc.) when available, instead of a generic "no PR" message; the server logs the same reason under `[pr-detect]`.
- `GET /open?path=<repo>` redirects to the matching project review URL — lets external tools deep-link by repo path without knowing the project slug.

### Changed

- `j` / `k` (and arrow-key) navigation now scrolls the active row into view in the file sidebar, so paging through a long file list keeps the selection visible.
- Phase group headers in the sidebar get more breathing room (top border + margin) instead of butting against the preceding file rows.
- "Asked Claude" comments are visually distinct from pending-review comments — accent-tinted background and a thicker accent left border.
- Symbol lookup requires ripgrep — the server fails loudly with an install hint if `rg` is missing, instead of returning empty results.
- Pre-commit hook runs prettier + eslint; pre-push hook verifies `dist/` and `frontend/dist/` are in sync with source.

### Fixed

- New-file walkthrough stops now show distinct sections — pure-add hunks are sliced to their declared line span instead of bleeding into the next stop.
- LSP "go to definition" / "find references" results from `tsserver` resolve correctly when the project lives under a symlinked path; location paths are canonicalized to match the session's repo root, and the underlying caught error is preserved for diagnostics.
- `SessionManager` canonicalizes repoPath through symlinks before lookup, so projects opened via different but equivalent paths share a session.

### Removed

- Dead `.group-header` / `.phase-header` CSS left over from the pre-tree sidebar.

## [0.4.0] - 2026-05-12

### Added

- Iterative analysis refresh: the new `/lgtm refresh` skill re-classifies only the files whose diff changed since the last analysis, and `/lgtm analyze` automatically delegates to it when a prior analysis exists.
- `read_analysis` MCP tool — returns the stored analysis as JSON plus re-rendered markdown, with per-file freshness metadata (stale / missing / removed files, stale synthesis).
- `set_analysis` merge mode — merges new file entries into the existing analysis, preserving untouched entries (with explicit `removedFiles` for drops) and blob-stamping each entry; broadcasts `analysis_changed`.
- Managed-Claude connection awareness: a per-project claim record that's cleaned up when the MCP transport closes, `GET /project/:slug/connection-state` reporting claim + transport liveness, and `POST /project/:slug/refresh-analysis` which pushes a `refresh_analysis_requested` channel notification to the claimed Claude session. The UI gains a header connection indicator and a refresh-analysis button.
- Per-file staleness badges in the file sidebar and a stale-count chip in the analysis overview banner; the UI refetches freshness on `analysis_changed` / `git_changed` SSE events.
- `GET /project/:slug/analysis/freshness` REST endpoint.
- GitHub Actions CI: lint, build, and test on push and pull request.

### Changed

- Frontend source reformatted to Prettier defaults; `npm run format:check` is now enforced in CI.

## [0.3.0] - 2026-05-06

### Added

- Keyboard shortcuts overlay: press `?` from anywhere in the UI to see all shortcuts grouped by category (Navigation, Review, Search, Help).

### Fixed

- Cmd-click symbol lookup ("peek") now resolves correctly when clicking on a usage of a symbol, not just on the declaration. The click offset was being computed inside the highlight.js token rather than across the whole line, so `ShortcutSection` (and any other identifier rendered as its own highlighted span) only resolved when the line happened to contain a declaration TS could navigate to from column 0.
- `/lgtm` slash command no longer references the removed `start` MCP tool; uses `claim_reviews` instead.

## [0.2.1] - 2026-05-06

### Fixed

- `walkthrough-author` agent now lives at the canonical `agents/walkthrough-author/AGENT.md` path so Claude Code auto-discovers it. Previously at `.claude-plugin/agents/`, which is not a discovery path — `/lgtm walkthrough` and `/lgtm prepare` would fail to load the agent on marketplace installs.
- Agent frontmatter uses the canonical `tools:` field instead of `allowed-tools:` (skill-only field). The `synthesizer` and `file-classifier` agents previously inherited all tools because the wrong field name was silently ignored; they're now correctly restricted to their declared tool sets.

## [0.2.0] - 2026-05-06

### Added

- Comments now surface a failed save with a retry affordance instead of silently swallowing the error ([#2](https://github.com/tomplex/lgtm/issues/2)).

### Fixed

- Server hardening: top-level error handlers, SSE keepalive, and `mkdirp` on the review directory before write ([#2](https://github.com/tomplex/lgtm/issues/2)).
- Static file serving: corrected frontend `dist` path and allowed dotfiles so installs under `~/.claude/plugins` work ([#1](https://github.com/tomplex/lgtm/issues/1)).
- Hooks: symlink the data `node_modules` into `PLUGIN_ROOT` so ESM resolution succeeds; added a marketplace smoke test.

## [0.1.1] - 2026-04-30

### Fixed

- Marketplace install: rebuild `better-sqlite3` after `npm install --ignore-scripts` so the native binding is actually built ([#1](https://github.com/tomplex/lgtm/issues/1)).

### Changed

- Plugin install/server output is captured to `${CLAUDE_PLUGIN_DATA}/install.log` and `${CLAUDE_PLUGIN_DATA}/server.log` instead of `/dev/null`, so failures surface.

## [0.1.0] - earlier

Initial baseline. No git tag — release process started at 0.1.1.
