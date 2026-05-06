# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
