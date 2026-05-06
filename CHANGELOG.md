# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-04-30

### Fixed

- Marketplace install: rebuild `better-sqlite3` after `npm install --ignore-scripts` so the native binding is actually built ([#1](https://github.com/tomplex/lgtm/issues/1)).

### Changed

- Plugin install/server output is captured to `${CLAUDE_PLUGIN_DATA}/install.log` and `${CLAUDE_PLUGIN_DATA}/server.log` instead of `/dev/null`, so failures surface.

## [0.1.0] - earlier

Initial baseline. No git tag — release process started at 0.1.1.
