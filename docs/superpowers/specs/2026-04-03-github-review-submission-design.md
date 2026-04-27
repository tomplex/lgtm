# GitHub Review Submission

## Background

LGTM currently submits review feedback to Claude via a local file (`/tmp/claude-review/{slug}.md`) and channel notification. This works for the case where Claude is the author and the reviewer wants Claude to address feedback. But when reviewing a PR authored by a human (or when the reviewer simply wants their comments on the PR itself), there's no way to send comments to GitHub — the reviewer has to manually recreate their feedback on the PR.

## Goal

Add a submit target dropdown so the reviewer can send their review either to Claude (existing flow) or directly to a GitHub PR as an atomic review with inline comments. The two targets are mutually exclusive per submission.

## Constraints

- Only diff comments are valid for GitHub submission (document comments have no PR equivalent)
- GitHub submit option only appears when a PR is detected (`repoMeta.pr` exists)
- Default submit target is Claude (preserves current behavior)
- No new npm dependencies — uses `gh api` for the GitHub API call
- Auth comes implicitly from `gh` CLI (no token management needed)

## Data Model Changes

### Add `side` to Comment

The GitHub PR review API requires `side: "RIGHT" | "LEFT"` to indicate which version of the file a comment targets. Currently `Comment.line` stores an absolute line number but doesn't track which side it came from.

**Change:** Add an optional `side` field to `Comment`:

```typescript
export interface Comment {
  // ... existing fields
  side?: 'RIGHT' | 'LEFT';
}
```

**Population:** In `DiffLine.tsx`, when creating a comment, derive `side` from which line number was used:
- If `props.line.newLine` is non-null → `side: 'RIGHT'`, `line: props.line.newLine`
- If only `props.line.oldLine` is non-null → `side: 'LEFT'`, `line: props.line.oldLine`

This matches the existing `absLine()` logic (`newLine ?? oldLine`) but preserves which branch it came from. Existing comments without `side` default to `'RIGHT'` at submission time (safe default since most review comments target the new code).

Both `comment-types.ts` files (server + frontend) get the new field. `CreateComment` inherits it via `Omit<Comment, 'id' | 'status'>`. The comment-api `createComment` input type already passes through arbitrary fields, so it picks up `side` automatically.

### Extend `RepoMeta.pr`

Add `owner` and `repo` fields, parsed from the PR URL:

```typescript
pr?: { url: string; number: number; title: string; owner: string; repo: string };
```

The URL from `gh pr view --json url` is always `https://github.com/{owner}/{repo}/pull/{number}`. Parse it in `getRepoMeta` when the `gh pr view` call succeeds.

## Server Changes

### New route: `POST /project/:slug/submit-github`

Accepts the same request shape as the existing `/submit` route but posts to GitHub instead of writing to the local feedback file.

**Request body:**
```typescript
{
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
  body?: string;  // optional overall review summary
}
```

**Flow:**
1. Read all active diff comments for this session (author=user, item=diff, status=active, mode=review, no parentId)
2. Validate that `session.repoMeta.pr` exists, 400 if not
3. Map each comment to GitHub's format:
   ```typescript
   {
     path: comment.file,
     line: comment.line,
     side: comment.side ?? 'RIGHT',
     body: comment.text
   }
   ```
4. Shell out to `gh api`:
   ```
   gh api repos/{owner}/{repo}/pulls/{number}/reviews \
     --method POST \
     --input -
   ```
   With JSON on stdin:
   ```json
   {
     "event": "COMMENT",
     "body": "Review submitted via LGTM",
     "comments": [...]
   }
   ```
5. On success: clear the submitted comments from the session (same as current submit flow), return `{ ok: true, reviewUrl: <url> }`
6. On failure: return the GitHub error to the frontend so the user can see what went wrong (e.g., comment on a line not in the diff)

**Working directory:** The `gh api` call runs with `cwd` set to `session.repoPath` so that `gh` picks up the correct repo context and auth.

### Thread handling

Reply comments (those with `parentId`) are not submitted as separate GitHub review comments. Their text is appended to the parent comment body, separated by a line break, so the full thread appears as one GitHub comment. This keeps the GitHub review clean and avoids orphaned replies.

## Frontend Changes

### Submit dropdown in Header

Replace the single "Submit Review" button with a split button + dropdown:

```
[Submit to Claude ▾]
```

Dropdown options:
- **Submit to Claude** (default) — existing flow
- **Submit to GitHub PR** — only visible when `repoMeta().pr` exists and `activeItemId() === 'diff'`

When "Submit to GitHub PR" is selected:
1. A secondary dropdown appears for the review verdict: Comment (default), Approve, Request Changes
2. An optional text input appears for the overall review body
3. Submit calls the new `/submit-github` route instead of `/submit`

The dropdown selection is not persisted — it resets to "Submit to Claude" on page load.

### Submit to GitHub flow in App.tsx

New `handleSubmitGithub` function:
1. Collect active diff comments (same filtering as `formatDiffComments` but structured, not markdown)
2. POST to `/project/{slug}/submit-github` with `{ event, body }`
3. On success: show toast with link to the review on GitHub, clear comments
4. On error: show toast with the error message

### Disabled state

The "Submit to GitHub PR" option is grayed out with a tooltip when:
- No PR detected
- Active item is not the diff
- No active diff comments exist

## What This Does NOT Include

- Syncing GitHub PR comments back into LGTM
- Webhook-triggered reviews
- GitHub OAuth (relies on `gh` CLI auth)
- Document comment submission to GitHub (no PR equivalent)
- Multi-line comment ranges (`start_line` + `line`) — each comment targets a single line

## Error Handling

- `gh` not installed or not authenticated: the `/submit-github` route returns a clear error ("gh CLI not found" or "not authenticated — run `gh auth login`")
- Comment on a line not in the diff: GitHub rejects the individual comment. The server includes the GitHub error in the response so the user can see which comment failed and why.
- No PR detected: the frontend prevents submission (button disabled), server returns 400 as a safety net
