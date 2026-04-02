# Unified Comment Model — Design Spec

Replace LGTM's separate comment data structures (`_claudeComments`, `_userComments`, frontend `comments` map) with a single unified model. This is a prerequisite for the channels feature but independently valuable — it simplifies the data model and makes comment threads a first-class concept.

## Current State

Three separate structures hold comment data:

1. **`_claudeComments: Record<string, ClaudeComment[]>`** (server, Session) — Claude's seeded comments, keyed by item ID. Each has `id`, `file`, `line`, `block`, `comment`.
2. **`_userComments: Record<string, string>`** (server, Session) — user review comments, keyed by `filepath::lineIdx` or `doc:itemId:blockIdx`. Plain text values.
3. **`comments: Record<string, string>`** (frontend, state.ts) — client-side mirror of user comments plus replies to Claude comments (keyed `claude:{id}`). Synced to server via `PUT /user-state/comment`.

Replies to Claude comments are stored as user comments with a `claude:{id}` key convention. There's no formal thread structure — the relationship is implicit in the key format.

## Unified Comment Type

```typescript
interface Comment {
  id: string;
  author: 'user' | 'claude';
  text: string;
  parentId?: string;       // reply to another comment
  item: string;            // 'diff' or document ID
  // location (for root comments):
  file?: string;
  line?: number;
  block?: number;
  // user comment distinction:
  mode?: 'review' | 'direct';  // only for author: 'user'
}
```

- `author` determines rendering: "Claude" label with reply/resolve/dismiss actions, or "You" label with edit/delete actions.
- `mode: 'review'` — batched user comment, included in review submission, no immediate action.
- `mode: 'direct'` — immediate "Ask Claude" question (used by the channels feature in stage 2).
- `parentId` links replies to their parent. A thread is a root comment plus its replies.
- Claude comments (`author: 'claude'`, no `mode`) behave as they do today — seeded via the `comment` MCP tool, user can reply/resolve/dismiss.

## Server Changes

### Session data model

Replace `_claudeComments` and `_userComments` with a single `_comments: Comment[]` array on Session.

Querying by item, file, author, parentId, or mode is done with array filters. The existing methods (`addComments`, `setUserComment`, `deleteUserComment`, etc.) are replaced with unified `addComment`, `getComments`, `updateComment`, `deleteComment` methods.

### Resolved/dismissed state

`_resolvedComments` stays as a `Set<string>` of comment IDs on the server. No change to this mechanism — it's already ID-based and works with the unified model.

### Persistence migration

The `ProjectBlob` schema changes to include a `comments: Comment[]` field. On load, if the blob has the old shape (`claudeComments` + `userComments` fields), convert it:

- Each `ClaudeComment` in `_claudeComments[itemId]` becomes `{ ...cc, author: 'claude', item: itemId, text: cc.comment }`.
- Each entry in `_userComments` becomes `{ author: 'user', mode: 'review', item, file, line/block, text }`, with location parsed from the key format.
- Replies (keys matching `claude:{id}`) become `{ author: 'user', parentId: id, text, item: 'diff' }`.

After migration, the blob is re-saved in the new format so the conversion only happens once.

### API route changes

- `POST /project/:slug/comments` — currently takes `{ item, comments[] }` for Claude to add comments. Stays the same interface but stores as unified `Comment` with `author: 'claude'`.
- `PUT /user-state/comment` — currently takes `{ key, text }`. Adapts to create/update a `Comment` with `author: 'user', mode: 'review'`. The key format is parsed to extract item/file/line/block.
- `GET /project/:slug/data` — currently returns `claudeComments` and `userComments` separately. Returns a single `comments` array, filtered by item. The frontend adapts to consume this.
- `GET /project/:slug/user-state` — `comments` field changes from key-value map to filtered `Comment[]`.

### MCP tool changes

The `comment` tool stores comments with `author: 'claude'` — no interface change for Claude.
The `read_feedback` tool reads from the output file — unchanged.

## Frontend Changes

### State

Replace the `comments: Record<string, string>` map and `claudeComments` array in `state.ts` with a single `comments: Comment[]` array. The `resolvedComments` set stays as-is (already ID-based).

Remove `lineIdToKey` — location is stored directly on the Comment object, so there's no need to derive keys from line IDs.

### Rendering

`comments.ts` and `claude-comments.ts` are refactored to work with unified `Comment` objects:

- When rendering a diff line or document block, filter `comments` by location to find root comments and their replies.
- Root comments render with author-appropriate styling (Claude label vs. You label).
- Replies render beneath their parent, threaded.
- Actions (reply, resolve, dismiss, edit, delete) are determined by `author` field.

The existing `renderClaudeCommentHtml` and `toggleComment`/`saveComment`/`editComment` functions are refactored to be author-agnostic where possible.

### Review submission

`formatAllComments()` and related formatting functions gather `mode: 'review'` user comments and Claude interactions (replies, resolved state). The output format stays the same — this is what Claude reads via `read_feedback`.

### Persistence (frontend)

`saveState` currently syncs user comments to the server via `PUT /user-state/comment`. This adapts to work with the unified model — on save, send the comment object (or just text + ID for updates).

## What stays the same

- Review submission flow and output format
- Resolved/dismissed state mechanism
- SSE broadcast infrastructure
- Git watcher
- Analysis pipeline
- MCP tool interfaces (from Claude's perspective)

## What changes

- Session: `_claudeComments` + `_userComments` → `_comments: Comment[]`
- ProjectBlob: new schema with migration from old format
- API: `/data` returns unified comments; `/user-state/comment` creates unified Comment objects
- Frontend state: single `comments` array replaces two separate structures
- Frontend rendering: `comments.ts` and `claude-comments.ts` refactored for unified type
- Key-based comment addressing replaced with ID-based addressing
