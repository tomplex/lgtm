# Unified Comment Model — Design Spec

Replace LGTM's separate comment data structures (`_claudeComments`, `_userComments`, frontend `comments` map) with a single unified model. This is a prerequisite for the channels feature but independently valuable — it simplifies the data model, makes comment threads a first-class concept, and enables comments in whole-file view.

## Current State

Three separate structures hold comment data:

1. **`_claudeComments: Record<string, ClaudeComment[]>`** (server, Session) — Claude's seeded comments, keyed by item ID. Each has `id`, `file`, `line`, `block`, `comment`.
2. **`_userComments: Record<string, string>`** (server, Session) — user review comments, keyed by `filepath::lineIdx` or `doc:itemId:blockIdx`. Plain text values.
3. **`comments: Record<string, string>`** (frontend, state.ts) — client-side mirror of user comments plus replies to Claude comments (keyed `claude:{id}`). Synced to server via `PUT /user-state/comment`.

Replies to Claude comments are stored as user comments with a `claude:{id}` key convention. There's no formal thread structure — the relationship is implicit in the key format. Resolved state lives in a separate `Set<string>` on both server and frontend.

## Unified Comment Type

```typescript
interface Comment {
  id: string;
  author: 'user' | 'claude';
  text: string;
  status: 'active' | 'resolved' | 'dismissed';
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
- `status` replaces the separate `_resolvedComments` Set. `dismissed` hides the comment without deleting it (recoverable, unlike the current dismiss-by-delete behavior).
- `mode: 'review'` — batched user comment, included in review submission, no immediate action.
- `mode: 'direct'` — immediate "Ask Claude" question (used by the channels feature in stage 2).
- `parentId` links replies to their parent. A thread is a root comment plus its replies.
- Claude comments (`author: 'claude'`, no `mode`) behave as they do today — seeded via the `comment` MCP tool, user can reply/resolve/dismiss.

## CommentStore

Pull comment management out of Session into a dedicated `CommentStore` class. Session delegates to it.

```typescript
class CommentStore {
  private _comments: Comment[] = [];

  add(comment: Omit<Comment, 'id' | 'status'>): Comment;
  get(id: string): Comment | undefined;
  update(id: string, fields: Partial<Pick<Comment, 'text' | 'status'>>): void;
  delete(id: string): boolean;
  list(filter?: { item?: string; file?: string; author?: string; parentId?: string; mode?: string }): Comment[];
  toJSON(): Comment[];
  static fromJSON(data: Comment[]): CommentStore;
}
```

Session keeps the orchestration: broadcasting SSE events after mutations, calling `persist()`, etc. CommentStore is pure data — no side effects, easy to test.

## Server Changes

### Session integration

Session replaces `_claudeComments`, `_userComments`, and `_resolvedComments` with a single `_commentStore: CommentStore` field. The existing methods (`addComments`, `setUserComment`, `deleteUserComment`, `toggleUserResolvedComment`, etc.) are removed in favor of the CommentStore API, called through Session wrapper methods or directly from the route handlers.

### Persistence migration

The `ProjectBlob` schema changes to include a `comments: Comment[]` field. On load, if the blob has the old shape (`claudeComments` + `userComments` fields), convert it:

- Each `ClaudeComment` in `_claudeComments[itemId]` becomes `{ ...cc, author: 'claude', status: 'active', item: itemId, text: cc.comment }`.
- Each entry in `_userComments` becomes `{ author: 'user', mode: 'review', status: 'active', item, file, line/block, text }`, with location parsed from the key format.
- Replies (keys matching `claude:{id}`) become `{ author: 'user', parentId: id, status: 'active', text, item: 'diff' }`.
- Each entry in `_resolvedComments` sets `status: 'resolved'` on the matching comment.

After migration, the blob is re-saved in the new format so the conversion only happens once.

### REST API

Replace the scattered comment-related routes with a clean CRUD resource:

**`GET /project/:slug/comments`** — list with optional filters
- Query params: `item`, `file`, `author`, `parentId`, `mode`, `status`
- Returns `{ comments: Comment[] }`

**`POST /project/:slug/comments`** — create a comment
- Body: `{ author, text, item, file?, line?, block?, parentId?, mode? }`
- Returns `{ ok: true, comment: Comment }`
- Broadcasts `comments_changed` via SSE

**`PATCH /project/:slug/comments/:id`** — update text or status
- Body: `{ text?, status? }`
- Returns `{ ok: true, comment: Comment }`
- Broadcasts `comments_changed` via SSE

**`DELETE /project/:slug/comments/:id`** — hard delete
- Returns `{ ok: true }`
- Broadcasts `comments_changed` via SSE

The old routes (`POST /comments`, `PUT /user-state/comment`, `PUT /user-state/resolved`, `DELETE /comments`) are removed.

### Data endpoint changes

`GET /project/:slug/data` currently returns `claudeComments` and `userComments` separately. It drops both fields — clients use the new `GET /comments` endpoint instead.

`GET /project/:slug/user-state` drops the `comments` and `resolvedComments` fields. Sidebar view and reviewed files stay.

### MCP tool changes

The `comment` MCP tool creates comments with `author: 'claude'` via the new `POST /comments` route (or directly via CommentStore). No interface change for Claude.

The `read_feedback` tool reads from the output file — unchanged.

## Frontend Changes

### State

Replace the `comments: Record<string, string>` map and `claudeComments` array in `state.ts` with a single `comments: Comment[]` array. Remove `resolvedComments` Set (now a field on Comment). Remove `lineIdToKey` — location is stored directly on the Comment object.

### Rendering

`comments.ts` and `claude-comments.ts` are refactored to work with unified `Comment` objects:

- When rendering a diff line or document block, filter `comments` by location to find root comments and their replies.
- Root comments render with author-appropriate styling (Claude label vs. You label).
- Replies render beneath their parent, threaded.
- Actions (reply, resolve, dismiss, edit, delete) are determined by `author` and `status` fields.
- Resolve/dismiss change `status` via `PATCH /comments/:id` instead of updating a local Set.

The existing `renderClaudeCommentHtml` and `toggleComment`/`saveComment`/`editComment` functions are refactored to be author-agnostic where possible.

### Whole-file view comments

Comments are now addressable by `file` + `line` (not diff-line index), so they can render in whole-file view. When the user opens a file in whole-file mode, filter comments by `file` path and render them at the corresponding line numbers. Same rendering and interaction as diff view — reply, resolve, dismiss, edit, delete.

### Review submission

`formatAllComments()` and related formatting functions gather `mode: 'review'` user comments and Claude interactions (replies, resolved state). The output format stays the same — this is what Claude reads via `read_feedback`.

### Persistence (frontend)

Comment mutations go through the REST API (`POST`, `PATCH`, `DELETE /comments`). No more local-first save with background sync — the server is the source of truth. The frontend fetches comments on load and updates via SSE.

## What stays the same

- Review submission flow and output format
- SSE broadcast infrastructure (new event types use same mechanism)
- Git watcher
- Analysis pipeline
- MCP tool interfaces (from Claude's perspective)

## What changes

- **Session** — `_claudeComments` + `_userComments` + `_resolvedComments` replaced by `CommentStore`
- **New class** — `CommentStore` for pure comment CRUD
- **ProjectBlob** — new schema with migration from old format
- **API** — CRUD `/comments` resource replaces scattered routes
- **Frontend state** — single `comments: Comment[]` replaces three structures
- **Frontend rendering** — `comments.ts` and `claude-comments.ts` refactored for unified type
- **Whole-file view** — now renders comments
- **Key-based comment addressing** — replaced with ID-based addressing
- **Dismiss behavior** — now sets `status: 'dismissed'` instead of hard-deleting
