# Release process for tomplex/lgtm — design

## Background

`tomplex/lgtm` is a Claude Code plugin distributed via the `faradayio/fdy-skills` marketplace as a github-sourced plugin. Consumers run `/plugin update` to pull the latest. Today there's no formal release process: versions live in two files (`package.json` and `.claude-plugin/plugin.json`) that need to be bumped in lockstep, and there's no changelog, no git tags, and no release notes.

The trigger for formalizing this is bug #1 (better-sqlite3) where 0.1.0 → 0.1.1 was bumped manually. As coworkers begin using the tool, the maintainer wants release discipline that ensures changes actually reach them and they can see what changed.

## How marketplace updates actually work

For a github-sourced plugin (`{"source": {"repo": "owner/name", "source": "github"}}`), Claude Code's marketplace pulls HEAD of the default branch. The cache key is `plugin.json`'s `version` field (with `marketplace.json`'s `version` as fallback, and the commit SHA as final fallback). Tags and GitHub Releases are NOT consumed by the marketplace — they're for humans only.

The implication: the only thing that determines whether a coworker actually gets a change is whether `plugin.json`'s `version` was bumped. Everything else (tags, releases, CHANGELOG) is for visibility, not delivery.

## Design

A project-local `/release` skill at `.claude/skills/release/SKILL.md` that Claude invokes when the maintainer asks. The skill encodes the policy and process; Claude executes it directly via Bash, Read, and Edit. No bash wrapper script; no `npm version` lifecycle hooks.

The skill is committed to the repo so it travels with the codebase, but lives under `.claude/` rather than `skills/` so it does NOT ship to plugin consumers.

### Skill structure

Standard `SKILL.md` with frontmatter:
- `name: release`
- `description`: triggers on "release lgtm", "cut a release for lgtm" — tightly scoped to maintainer language so it never fires for end users
- `allowed-tools: Bash, Read, Edit, Grep`

Body covers: trigger conditions, pre-flight gates, version bump procedure, CHANGELOG composition, commit/tag/push, GitHub Release creation, announcement template, semver policy, failure modes.

### Process the skill drives

1. **Pre-flight gate** — verify on `main`, in sync with `origin/main`, and `git status` is clean. Then run `npm run build` and verify it produces no diff. If anything fails this gate, abort with a specific instruction (e.g., "commit the rebuilt `dist/` separately, then re-run").
2. **Quality gates** — run `npm test` and `npm run lint`. Abort on failure.
3. **Bump level** — show the maintainer the commit list since last tag with prefix counts (`feat: 2, fix: 1, chore: 3`) as a *suggestion*, then ask for the bump level. Never infer silently — `chore:`/`build:`/`style:` commits can carry real behavior changes (the rebuilt `dist/` lands as `build:` even when the source change was a `feat:`).
4. **Version edit** — Edit both `package.json` and `.claude-plugin/plugin.json` to the new version.
5. **CHANGELOG entry** — Compose from `git log v_prev..HEAD --oneline` in [Keep a Changelog](https://keepachangelog.com/) format. Prepend to `CHANGELOG.md` under a new `## [X.Y.Z] - YYYY-MM-DD` heading.
6. **Commit** — `git commit -m "release: vX.Y.Z"` (single-line per repo convention).
7. **Tag** — `git tag -a vX.Y.Z -m "<changelog entry body>"`.
8. **Push** — `git push origin main --follow-tags`. If the push is rejected, immediately `git tag -d vX.Y.Z` so the local tag doesn't orphan and skew the next release's `git log v_prev..HEAD` math. Then abort and report.
9. **GitHub Release** — `gh release create vX.Y.Z --notes "<changelog entry>"`. If this fails, the release commit + tag are already pushed; surface the error and tell the maintainer to retry just the `gh` step.
10. **Announce + reminder** — Emit a paste-able Slack template:
    ```
    lgtm vX.Y.Z is out — <one-line summary>. Run /plugin update to pull. Notes: <github release URL>
    ```
    Plus a one-line reminder: "`fdy-skills/marketplace.json` still pins lgtm to its old version — safe to leave (plugin.json is canonical), but if you ever bump it, keep it ≤ plugin.json's version."

### Semver policy (encoded in skill)

- **Patch** — bug fixes, doc updates, internal refactors, dependency bumps that don't change behavior
- **Minor** — new MCP tools, new UI features, new analysis modes, additive REST endpoints, new skills, new SSE events
- **Major** — removed or renamed MCP tools, breaking on-disk DB schema (`~/.lgtm/data.db`), changed REST contract shape

### Failure modes

- Tests/lint/build fail → stop, surface output, no version bump.
- Working tree dirty pre-flight (incl. uncommitted `dist/` after `npm run build`) → stop, ask the maintainer to commit or stash first. Specifically: if `npm run build` dirties `dist/`, the fix is "commit the rebuilt `dist/` as a separate `build:` commit, then re-run release" — bundling 50k LOC of rebuilt `dist/` into the release commit makes the diff unreviewable.
- Push rejected (divergence from origin) → delete the local tag (`git tag -d vX.Y.Z`) so it doesn't skew the next release's commit-range math, then abort.
- `gh release create` fails after push → release is live for `/plugin update` consumers; surface the error and instruct the maintainer to retry the `gh` step manually.

### What's intentionally NOT included

- **No bash release script** — Claude reads the skill and runs ops directly. If a human needs to release without Claude, the skill markdown is the runbook.
- **No `npm version` integration** — explicit Edits to both files are clearer than lifecycle hooks and require no additional `package.json` scripts.
- **No update to `fdy-skills/marketplace.json`'s version field** — that field is fallback-only since `plugin.json` carries an explicit version. Documented as vestigial.
- **No CI release workflow** — single maintainer + Claude is the release path.
- **No automated coworker notifications** — GitHub Releases (subscribable) plus a manual Slack post is the visibility surface.

## One-time bootstrap

Before the skill is useful for the next release:

1. **Create `CHANGELOG.md`** seeded with:
   - `## [0.1.1] - 2026-04-30` — summarizing the better-sqlite3 hook fix (issue #1)
   - `## [0.1.0]` — baseline marker
2. **Retroactively tag `v0.1.1`** on current `main` (commit `7c60213`) so the skill has a "last release" anchor for the next bump. Annotated tag, message drawn from the CHANGELOG entry.
3. **Add `docs/RELEASING.md`** — a one-paragraph human-facing note: "ask Claude `/release` (or read `.claude/skills/release/SKILL.md` for the manual procedure)."

## Open questions

None.
