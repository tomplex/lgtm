---
name: release
description: >
  Use when the maintainer asks to "release lgtm", "cut a release for lgtm",
  or "ship a new lgtm version". Drives the full release process: pre-flight
  gates, version bump, CHANGELOG entry, commit, tag, push, and GitHub Release.
  Maintainer-only — do not invoke for unrelated requests.
allowed-tools: Bash, Read, Edit, Grep
---

# Releasing lgtm

You are about to cut a release of the lgtm Claude Code plugin. Follow these
steps in order. If any gate fails, stop and report — do not skip ahead.

## How releases reach coworkers

The plugin is consumed via the `faradayio/fdy-skills` marketplace as a github
source. Claude Code pulls HEAD of `main` and uses `.claude-plugin/plugin.json`'s
`version` field as the cache key. **The version bump in `plugin.json` is the
only thing that delivers the change to coworkers.** Tags and GitHub Releases
are humans-only — they exist for visibility and subscribable notifications.

Note: `v0.1.1` may have no GitHub Release — it was tagged retroactively and
the Release was opt-in during bootstrap. `gh release list` missing v0.1.1 is
expected; don't try to backfill it from a future release run.

## Process

### 1. Pre-flight gate

Run each command. Stop on the first failure.

```bash
git rev-parse --abbrev-ref HEAD     # must print 'main'
git status --porcelain              # must be empty
git fetch origin
git status                          # must say 'up to date with origin/main'
npm run build                       # must produce no diff
git status --porcelain              # still must be empty after the build
```

If `npm run build` dirties `dist/` or `frontend/dist/`: **stop**. Tell the
maintainer to commit the rebuilt output as a separate `build:` commit, then
re-invoke this skill. Bundling 50k+ LOC of rebuilt dist with a 2-line
version bump makes the release commit unreviewable.

### 2. Quality gates

```bash
npm test
npm run lint
```

Either failure → stop, surface the output, do not proceed.

### 3. Pick the bump level

```bash
PREV_TAG=$(git describe --tags --abbrev=0)
git log --oneline "${PREV_TAG}..HEAD"
git log --format="%s" "${PREV_TAG}..HEAD" | grep -oE '^[a-z]+' | sort | uniq -c
```

Show the maintainer:
- The full commit list since the last tag
- The prefix histogram (e.g., `feat: 2, fix: 1, chore: 3`) as a **suggestion only**

**Do not infer silently.** Ask: "Bump as patch, minor, or major?"

Why: `chore:` / `build:` / `style:` commits regularly carry behavior changes
(e.g., a rebuilt `dist/` lands as `build:` even when the underlying source
change was a `feat:`). Auto-inference would mis-tag.

Semver policy:
- **Patch** — bug fixes, doc updates, internal refactors, dep bumps that don't change behavior
- **Minor** — new MCP tools, new UI features, new analysis modes, additive REST endpoints, new skills, new SSE events
- **Major** — removed or renamed MCP tools, breaking on-disk DB schema (`~/.lgtm/data.db`), changed REST contract shape

### 4. Bump versions

Edit both files to the new `X.Y.Z`:
- `package.json` → `"version": "X.Y.Z"`
- `.claude-plugin/plugin.json` → `"version": "X.Y.Z"`

### 5. Compose the CHANGELOG entry

Read `CHANGELOG.md`. Prepend a new entry under the top heading section using
[Keep a Changelog](https://keepachangelog.com/) format:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- (new features)

### Changed
- (behavior changes)

### Fixed
- (bug fixes, with issue links if applicable)

### Removed
- (removed features — major bump only)
```

Source the entries from `git log "${PREV_TAG}..HEAD"`. Group by intent
(features → Added, fixes → Fixed, etc.). Reference issue numbers (`#1`,
`#2`) where commits cite them. Drop empty subsections.

### 6. Commit

```bash
git add package.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "release: vX.Y.Z"
```

Single-line commit message per repo convention.

### 7. Tag

Read the new CHANGELOG entry (everything between `## [X.Y.Z]` and the next
`## [` heading or EOF). Use that as the tag message body:

```bash
git tag -a --cleanup=verbatim "vX.Y.Z" -m "<changelog entry body>"
```

`--cleanup=verbatim` is required: without it, `git tag` strips lines starting
with `#`, which would eat `### Fixed` / `### Changed` markdown headers from
the message.

### 8. Push

```bash
git push origin main --follow-tags
```

If the push is **rejected** (divergence from origin):

```bash
git tag -d "vX.Y.Z"
```

Delete the local tag immediately so the next release's `git log v_prev..HEAD`
math doesn't drift. Then abort and tell the maintainer to resolve the
divergence first.

### 9. GitHub Release

```bash
gh release create "vX.Y.Z" \
  --title "vX.Y.Z" \
  --notes "<changelog entry body>"
```

If this fails: the release commit + tag are already on `origin/main`, so
`/plugin update` consumers will get the change. Surface the error and tell
the maintainer to retry just the `gh` step manually.

### 10. Announce

Emit this template for the maintainer to paste into Slack:

```
lgtm vX.Y.Z is out — <one-line summary of the most user-visible change>.
Run /plugin update to pull. Notes: <github release URL>
```

`fdy-skills/marketplace.json` has no `version` field for lgtm — Claude Code
falls back to `plugin.json`'s version on the upstream repo (the only source
of truth). Nothing to sync there.

## Failure summary

| Failure | What to do |
|---|---|
| Tests / lint / build fail | Stop, surface output, no version bump |
| `npm run build` dirties dist | Stop, ask maintainer to commit `build:` separately |
| Working tree dirty pre-flight | Stop, ask maintainer to commit or stash |
| Push rejected | `git tag -d vX.Y.Z`, abort |
| `gh release create` fails after push | Release is live; retry `gh` step manually |
