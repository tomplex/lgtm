# MCP Auto-Init

## Background

The LGTM MCP server currently exposes a `start` tool that must be called before any other tool can be used against a repo. Every other tool (`add_document`, `comment`, `read_feedback`, `set_analysis`, `claim_reviews`, `reply`, `stop`) calls `requireProject`, which errors with "Project not registered. Call start first." if the repo isn't registered.

`manager.register()` is already idempotent — it returns the existing slug if the repo is already registered — so the two-step dance is entirely ceremonial. It exists because `start` also carries three side responsibilities: setting a `description` banner, overriding `baseBranch`, and claiming diff review notifications for the calling MCP session.

## Goal

Any MCP tool call auto-registers the project it's called with. Claude never has to "initialize" a project as a distinct step. The `start` tool is removed; its remaining responsibilities move to the explicit tool that fits them best (`claim_reviews`).

## Behavior change

### Auto-init in `requireProject`

Rename `requireProject` to `resolveProject`. New behavior:

1. `manager.findByRepoPath(repoPath)` — if found, return it.
2. If not found, call `manager.register(repoPath)` with no description and no baseBranch override. `register` runs `detectBaseBranch` and writes the empty output file.
3. Associate the calling MCP session with the resolved slug (same as today).
4. Return the resolved `{ slug, session }`.

`resolveProject` no longer has an error path — it always returns a project. Its callers drop the `if ('error' in lookup)` check. The "Project not registered. Call start first." string is removed.

### Auto-claim behavior

When `resolveProject` runs, it also performs a conditional claim:

- If no MCP session currently holds the diff-review claim for this slug, grant the claim to the calling MCP session.
- If another session already holds the claim, do nothing.

This gives the common case (one Claude session working on a repo) zero-ceremony notifications, without a sub-agent stealing the claim when it posts a comment.

`claim_reviews` bypasses `resolveProject` and calls `manager.register` + `claimDiffReviews` directly (see below), so its unconditional-override semantics are preserved.

### `stop` is special

`stop` is a teardown operation. Auto-init is nonsensical for it. `stop` keeps its own error path with a clearer message: `"No active review session for this repo path."`

## Tool surface changes

### Remove `start`

The `start` tool is removed from the MCP surface entirely.

### Grow `claim_reviews`

`claim_reviews` absorbs `start`'s remaining responsibilities. New shape:

```ts
server.tool(
  'claim_reviews',
  'Claim code review notifications for a project. Auto-registers the project if needed. When the reviewer submits feedback on the diff, only the Claude session that called claim_reviews most recently will receive the notification. Returns the review URL.',
  {
    repoPath: z.string().describe('Absolute path to the git repository'),
    description: z.string().optional().describe('Review context shown as a banner in the UI'),
    baseBranch: z.string().optional().describe('Base branch (auto-detected if omitted)'),
  },
  // ...
);
```

Implementation:

- Call `manager.register(repoPath, { description, baseBranch })` directly (not `resolveProject`) so `description` and `baseBranch` actually flow through. `register` is idempotent and already updates `baseBranch` on existing sessions when provided. It does not currently update `description` on existing sessions — extend it to do so when `description` is explicitly passed (non-undefined).
- Call `claimDiffReviews(server, result.slug)` (unconditional override — that's the whole point of the tool).
- Return `{ slug, url }` (same shape today's `start` returns).

### Other tools

`add_document`, `comment`, `read_feedback`, `set_analysis`, `reply` — no signature changes. Internally they call `resolveProject` instead of `requireProject` and lose the error branch. They get the auto-claim-if-unclaimed behavior for free.

`stop` — no signature change. Keeps its own "not registered" error.

## Skill and docs updates

- `skills/lgtm/SKILL.md` and any skill content that references the `start` tool updates to use `claim_reviews` as the explicit entry point. The typical flow becomes: call `claim_reviews` once at the top of a review session (to set description and claim notifications), then call `comment` / `add_document` / `read_feedback` as needed.
- MCP tool descriptions in `server/mcp.ts` drop any "Must be called after start" / "Requires an active session" phrasing.

## Tests

Add server tests covering the new behavior:

1. `comment` on an unregistered repo auto-registers and succeeds. After the call, the project appears in `manager.list()`.
2. `comment` from a session with no prior claim auto-claims diff reviews for that session.
3. `comment` from a second session does NOT steal the claim from the first.
4. `claim_reviews` from any session always takes the claim (including when another session held it).
5. `claim_reviews` with `description` on a fresh repo sets the banner.
6. `claim_reviews` with `description` on an already-registered repo updates the banner.
7. `claim_reviews` returns `{ slug, url }`.
8. `stop` on an unregistered repo still returns the "no active review session" error.
9. Removing `start` doesn't break any currently-passing test (update tests that called `start` to call `claim_reviews` instead, or rely on auto-init).

## Out of scope

- Changing the notification channel protocol.
- Changing the REST API surface (this is MCP-only).
- Any UI changes. The review UI doesn't distinguish between auto-init and explicit-start projects.
- Persisting the auto-claim across server restarts (today's claim is in-memory per MCP session, and that doesn't change).
