# Release Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/release` skill plus the bootstrap artifacts (CHANGELOG, retroactive `v0.1.1` tag, RELEASING.md) so future releases of the `tomplex/lgtm` plugin are mechanical, version-bump-correct, and visible to coworkers.

**Architecture:** A single project-scoped skill at `.claude/skills/release/SKILL.md` encodes the full release runbook. Claude executes it directly via `Bash`/`Read`/`Edit` — no shell wrapper, no `npm version` lifecycle hooks. The skill lives under `.claude/` so it does NOT ship to plugin consumers, but is committed to the repo so it travels with the codebase.

**Tech Stack:** Bash, `git`, `npm`, `gh` CLI, Keep a Changelog markdown convention.

**Spec:** `docs/superpowers/specs/2026-05-06-release-process-design.md`

**Important context:** When this plan executes, current `main` HEAD (`671ddee`) is 4 commits past the `7c60213` version-bump for 0.1.1. The retroactive tag in Task 5 anchors `v0.1.1` to `7c60213` (where `plugin.json` actually said 0.1.1), not to HEAD. The unreleased commits (`f920c79`, `842cda7`, `9dc7e89`, `671ddee`) become the payload of the FIRST real `/release` invocation after this plan completes — not part of this plan.

---

## File Structure

| Path | Purpose |
|---|---|
| `.claude/skills/release/SKILL.md` | NEW. The release runbook Claude follows. |
| `CHANGELOG.md` | NEW. Seeded with 0.1.0 + 0.1.1 entries; future releases prepend. |
| `docs/RELEASING.md` | NEW. One-paragraph human-facing pointer to the skill. |
| `v0.1.1` tag | NEW (annotated). Anchors `7c60213` so the next release has a `git log v_prev..HEAD` baseline. |

---

## Task 1: Create CHANGELOG.md

**Files:**
- Create: `/Users/tom/dev/claude-review/CHANGELOG.md`

- [ ] **Step 1: Write the file**

```markdown
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
```

- [ ] **Step 2: Verify the file**

Run: `head -5 CHANGELOG.md`
Expected: starts with `# Changelog`.

---

## Task 2: Create the `/release` skill

**Files:**
- Create: `/Users/tom/dev/claude-review/.claude/skills/release/SKILL.md`

- [ ] **Step 1: Create the parent directory**

Run: `mkdir -p .claude/skills/release`

- [ ] **Step 2: Write the skill file**

````markdown
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
git tag -a "vX.Y.Z" -m "<changelog entry body>"
```

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

Plus a one-line reminder:

> Note: `fdy-skills/marketplace.json` still pins lgtm to its old version.
> That's safe to leave (plugin.json is canonical), but if you ever bump it,
> keep it ≤ plugin.json's version.

## Failure summary

| Failure | What to do |
|---|---|
| Tests / lint / build fail | Stop, surface output, no version bump |
| `npm run build` dirties dist | Stop, ask maintainer to commit `build:` separately |
| Working tree dirty pre-flight | Stop, ask maintainer to commit or stash |
| Push rejected | `git tag -d vX.Y.Z`, abort |
| `gh release create` fails after push | Release is live; retry `gh` step manually |
````

- [ ] **Step 3: Verify frontmatter parses**

Run: `head -10 .claude/skills/release/SKILL.md`
Expected: opens with `---`, includes `name: release` and `description:`, closes with `---` before the body.

---

## Task 3: Create docs/RELEASING.md

**Files:**
- Create: `/Users/tom/dev/claude-review/docs/RELEASING.md`

- [ ] **Step 1: Write the file**

```markdown
# Releasing lgtm

Releases are managed by Claude. Ask Claude to "release lgtm" or "cut a release for lgtm" and it will follow the process documented in [`.claude/skills/release/SKILL.md`](../.claude/skills/release/SKILL.md).

To release manually without Claude, read that skill — it's the canonical runbook.
```

- [ ] **Step 2: Verify the file**

Run: `cat docs/RELEASING.md`
Expected: prints the content above.

---

## Task 4: Commit the new artifacts

- [ ] **Step 1: Stage and commit**

```bash
git add CHANGELOG.md .claude/skills/release/SKILL.md docs/RELEASING.md
git commit -m "chore: add release process (skill, changelog, releasing doc)"
```

- [ ] **Step 2: Verify exactly the three expected files**

Run: `git diff --name-only HEAD~1 HEAD | sort`
Expected output (exactly):
```
.claude/skills/release/SKILL.md
CHANGELOG.md
docs/RELEASING.md
```

If extras appear, abort and `git reset --soft HEAD~1` to unstage and recompose.

- [ ] **Step 3: Push**

```bash
git push origin main
```

Expected: push succeeds. If rejected, fetch + investigate before continuing.

---

## Task 5: Retroactively tag v0.1.1

This anchors the `0.1.1` release point on `7c60213` — the commit where `package.json` and `.claude-plugin/plugin.json` were bumped to `0.1.1`. Subsequent releases use this as the `git log v_prev..HEAD` baseline.

- [ ] **Step 1: Pre-flight check**

Run:
```bash
git rev-parse --abbrev-ref HEAD     # must print 'main'
git status --porcelain              # must be empty
```

If the working tree is dirty or you're on a different branch, abort. The tag itself is local-only at this point but the next step pushes; pushing from a divergent branch can surprise.

- [ ] **Step 2: Verify the target commit**

Run: `git show --stat 7c60213 | head -20`
Expected: `chore: bump version to 0.1.1`, modifies `package.json` and `.claude-plugin/plugin.json`.

- [ ] **Step 3: Create the annotated tag**

The tag message is the body of the `## [0.1.1]` section in `CHANGELOG.md`. Run this exactly:

```bash
git tag -a v0.1.1 7c60213 -m "$(cat <<'EOF'
### Fixed

- Marketplace install: rebuild `better-sqlite3` after `npm install --ignore-scripts` so the native binding is actually built ([#1](https://github.com/tomplex/lgtm/issues/1)).

### Changed

- Plugin install/server output is captured to `${CLAUDE_PLUGIN_DATA}/install.log` and `${CLAUDE_PLUGIN_DATA}/server.log` instead of `/dev/null`, so failures surface.
EOF
)"
```

Quoted heredoc (`<<'EOF'`) keeps the backticks and `${CLAUDE_PLUGIN_DATA}` literal — no shell interpolation.

- [ ] **Step 4: Verify the tag**

Run: `git show v0.1.1 | head -20`
Expected: shows the annotated tag pointing at `7c60213`, with the message above.

- [ ] **Step 5: Push the tag**

```bash
git push origin v0.1.1
```

Expected: `[new tag] v0.1.1 -> v0.1.1`.

---

## Task 6: Create the GitHub Release for v0.1.1

This is **opt-in** — it makes a public artifact for the already-shipped 0.1.1 so coworkers can subscribe to GitHub Releases for future notifications. Confirm with Tom before running.

- [ ] **Step 1: Confirm with Tom**

Ask: "Create the public `gh release` for v0.1.1 now? It's the first GitHub Release on the repo and will give coworkers a subscribable feed for future versions."

- [ ] **Step 2: If approved, create the release**

Use the same body as Task 5 step 2 (the 0.1.1 entry from CHANGELOG.md):

```bash
gh release create v0.1.1 \
  --title "v0.1.1" \
  --notes "$(cat <<'EOF'
### Fixed

- Marketplace install: rebuild `better-sqlite3` after `npm install --ignore-scripts` so the native binding is actually built ([#1](https://github.com/tomplex/lgtm/issues/1)).

### Changed

- Plugin install/server output is captured to `${CLAUDE_PLUGIN_DATA}/install.log` and `${CLAUDE_PLUGIN_DATA}/server.log` instead of `/dev/null`, so failures surface.
EOF
)"
```

Quoted heredoc (`<<'EOF'`) keeps `${CLAUDE_PLUGIN_DATA}` literal — no shell interpolation, no backslash escape needed.

- [ ] **Step 3: Verify**

Run: `gh release view v0.1.1`
Expected: shows the release with the notes above.

---

## Self-review checklist (post-implementation)

After all tasks complete, verify:

- [ ] `.claude/skills/release/SKILL.md` exists and the frontmatter parses
- [ ] `CHANGELOG.md` exists with `0.1.1` and `0.1.0` entries
- [ ] `docs/RELEASING.md` exists with the pointer
- [ ] `git tag -l` shows `v0.1.1`
- [ ] `git show v0.1.1` points at `7c60213`
- [ ] (If Task 6 ran) `gh release list` shows `v0.1.1`
- [ ] Working tree is clean

## What this plan does NOT do

- **Does not release the unreleased work on main.** Commits `f920c79`, `842cda7`, `9dc7e89`, `671ddee` are past the v0.1.1 anchor and need a future bump (likely `v0.2.0` since `9dc7e89` is a `feat:`). That's the first real use of the new `/release` skill — a separate user-initiated event after this plan ships.
- **Does not bump `fdy-skills/marketplace.json`.** That field is fallback-only; bumping it is unnecessary and the spec documents it as vestigial.
- **Does not add CI.** Single-maintainer + Claude is the release path.
