# Comment UX Improvements

Two changes: tighter comment sizing across the board, and a reply/resolve interaction model for Claude comments.

## 1. Comment box sizing (tight card)

All comment rows (user comments, Claude comments, and document block comments) switch to a tighter visual treatment.

### CSS changes

- Padding: `6px 10px` (down from `8px 12px`)
- Border-radius: `4px` (down from `6px`)
- Line-height: `1.4` (down from `1.5`)
- Left border stays: blue (`#58a6ff`) for user, purple (`#6e40c9`) for Claude
- Row padding: `4px 12px 4px 60px` (down from `8px 12px 8px 60px`)

### Interaction changes for user comments

- Inline action links (edit, delete) appear on hover, right-aligned within the comment card
- Clicking anywhere on the comment body still opens the edit textarea (preserving current behavior)
- The action links are shortcuts, not the only entry point
- No more separate actions row below the textarea in saved state
- Edit state still uses a textarea with Cancel/Save buttons below it, plus a Delete button - same as today but in the tighter card

### Interaction changes for Claude comments

- The "Claude" label stays inline (not a separate block line)
- Layout: `[Claude label] [comment text] [action links]` in a single flex row
- Action links: dismiss, reply, resolve (details in section 2)
- The `×` dismiss button in the top-right corner goes away - dismiss is now an action link

## 2. Claude comment reply/resolve model

Three actions on every Claude comment, shown as inline text links:

### Reply

- Clicking "reply" opens a textarea nested inside the Claude comment card, below Claude's text
- Textarea has Cancel/Save buttons
- On save, the reply appears as a nested sub-element inside the card:
  - Blue left border (`2px solid #58a6ff`)
  - "You" label (styled like Claude label but blue)
  - Reply text
  - Edit/delete action links on hover
- Clicking on a saved reply opens it for editing (same click-to-edit pattern as user comments)
- A Claude comment can have at most one reply

### Resolve

- Clicking "resolve" immediately marks the comment as resolved (no confirmation)
- Visual treatment: card fades to `opacity: 0.5`, border changes to `dashed`, "Resolved" badge appears (green, uppercase, same size as Claude label)
- Resolve replaces the reply/resolve/dismiss action links with an "unresolve" link
- Resolved comments stay visible in the diff

### Dismiss

- Same as today's behavior - removes the comment from view
- Calls `DELETE /comments` on the server to remove it
- Dismissed comments are not included in the review output

### State model

Each Claude comment gains a client-side status: `'open' | 'resolved' | 'dismissed'`

Replies are stored in the existing `comments` record with a key format of `claude:<item>:<serverIndex>` to associate them with the specific Claude comment they respond to.

No server-side changes needed. Reply text and resolve status are client-side state that gets formatted into the review output on submit.

## 3. Review output format

The submitted review markdown changes to include Claude comment context and responses.

### Format

User's standalone comments (not replies to Claude) keep the current format:

```
## src/server.py

Line 15: `+ port = args.port or stable_port_for_path(repo_path)`
> Should this fall back to 8080?
```

Claude comment interactions use labeled lines:

```
## src/server.py

Line 15: `+ port = args.port or stable_port_for_path(repo_path)`

**Claude:** This could collide with an existing service.
**Reply:** It's deterministic from the repo path hash, unlikely to collide.

**Claude:** Missing error handling for port in use.
**Status:** Resolved
```

Rules:
- Bold labels at the start of each line (`**Claude:**`, `**Reply:**`, `**Status:**`)
- Claude's original comment included verbatim so the reading agent has full context
- `**Reply:**` for text responses, `**Status:** Resolved` for wordless resolves
- Dismissed Claude comments are omitted entirely
- User's standalone comments and Claude interactions are separated by blank lines within a file section

## 4. Affected files

- `frontend/src/style.css` — padding, border-radius, line-height, resolved state styles, inline action styles
- `frontend/src/diff.ts` — Claude comment rendering (add reply/resolve/dismiss actions, reply display, resolved state)
- `frontend/src/comments.ts` — reply storage, `formatAllComments()` output format, reply CRUD
- `frontend/src/document.ts` — same tight card treatment for document-mode Claude comments
- `frontend/src/state.ts` — possibly a `resolvedComments` set or similar for tracking resolve state

## 5. Out of scope

- Markdown rendering in comments
- Comment persistence across refresh
- Server-side changes
- Line range commenting
- Review progress indicator
