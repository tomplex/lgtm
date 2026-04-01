# Comment UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten comment box sizing across the app and add reply/resolve/dismiss interactions for Claude comments.

**Architecture:** CSS changes for sizing, new client-side state (`resolvedComments` set, reply keys in `comments` record), updated HTML rendering in diff.ts and document.ts, updated output formatter in comments.ts. No server-side changes.

**Tech Stack:** TypeScript, CSS, vanilla DOM manipulation.

**Spec:** `docs/superpowers/specs/2026-03-31-comment-ux-design.md`

---

### Task 1: Add resolved state to state.ts

**Files:**
- Modify: `frontend/src/state.ts`

- [ ] **Step 1: Add resolvedComments set**

Add the resolved comments tracking set after the existing `reviewedFiles` set in `frontend/src/state.ts`:

```typescript
export const resolvedComments = new Set<string>();
```

This goes on the line after `export const reviewedFiles = new Set<string>();` (line 67). The keys will be `claude:<item>:<serverIndex>` format, matching how reply keys work in the `comments` record.

No setter needed — `Set` is mutable through `.add()` and `.delete()`.

- [ ] **Step 2: Verify build passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/state.ts
git commit -m "add resolvedComments set to state"
```

---

### Task 2: Tighten comment box CSS

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Update comment row padding**

In `frontend/src/style.css`, change `tr.comment-row td` (around line 297):

```css
  tr.comment-row td {
    padding: 4px 12px 4px 60px;
    background: var(--comment-bg);
    border-left: 3px solid var(--comment-border);
    white-space: normal;
    max-width: 0;
  }
```

- [ ] **Step 2: Update comment-box gap**

Change `.comment-box` (around line 305):

```css
  .comment-box {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: calc(100vw - 360px);
  }
```

- [ ] **Step 3: Update textarea padding**

Change `.comment-box textarea` (around line 312):

```css
  .comment-box textarea {
    width: 100%;
    min-height: 50px;
    padding: 6px 10px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 13px;
    resize: vertical;
    outline: none;
  }
```

- [ ] **Step 4: Update saved-comment styling**

Change `.saved-comment` (around line 350):

```css
  .saved-comment {
    padding: 6px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 13px;
    line-height: 1.4;
    white-space: pre-wrap;
    cursor: pointer;
    position: relative;
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
```

- [ ] **Step 5: Replace edit-hint with inline action links**

Replace the `.saved-comment .edit-hint` and `.saved-comment:hover .edit-hint` rules (around lines 362-371) with:

```css
  .saved-comment .comment-text { flex: 1; }
  .saved-comment .inline-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .saved-comment .inline-actions a {
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    text-decoration: none;
    padding: 2px 6px;
    border-radius: 3px;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .saved-comment:hover .inline-actions a { opacity: 1; }
  .saved-comment .inline-actions a:hover { background: var(--hover); color: var(--accent); }
  .saved-comment .inline-actions a.del-action:hover { color: var(--del-text); background: var(--del-line-bg); }
```

- [ ] **Step 6: Update Claude comment styles**

Replace the entire Claude comments section (around lines 576-614) with:

```css
  /* --- Claude comments --- */
  .claude-comment {
    padding: 6px 10px;
    background: #1a1528;
    border: 1px solid #6e40c9;
    border-radius: 4px;
    font-size: 13px;
    line-height: 1.4;
    white-space: pre-wrap;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .claude-comment .claude-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .claude-comment .claude-label {
    font-size: 10px;
    font-weight: 600;
    color: #a371f7;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }
  .claude-comment .claude-text {
    flex: 1;
    white-space: pre-wrap;
  }
  .claude-comment .inline-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .claude-comment .inline-actions a {
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    text-decoration: none;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .claude-comment .inline-actions a:hover {
    background: var(--hover);
    color: #a371f7;
  }
  tr.claude-comment-row td {
    padding: 4px 12px 4px 60px;
    background: #1a1528;
    border-left: 3px solid #6e40c9;
    white-space: normal;
    max-width: 0;
  }

  /* Resolved state */
  .claude-comment.resolved {
    opacity: 0.5;
    border-style: dashed;
  }
  .claude-comment .resolve-badge {
    font-size: 10px;
    font-weight: 600;
    color: var(--add-text);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }

  /* Reply nested inside Claude comment */
  .claude-reply {
    padding: 6px 8px;
    background: var(--bg);
    border-radius: 3px;
    border-left: 2px solid var(--accent);
    display: flex;
    align-items: baseline;
    gap: 8px;
    cursor: pointer;
  }
  .claude-reply:hover { border-color: var(--accent); }
  .claude-reply .reply-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }
  .claude-reply .reply-text {
    flex: 1;
    white-space: pre-wrap;
  }
  .claude-reply .inline-actions a {
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    text-decoration: none;
    padding: 2px 6px;
    border-radius: 3px;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .claude-reply:hover .inline-actions a { opacity: 1; }
  .claude-reply .inline-actions a:hover { background: var(--hover); color: var(--accent); }
  .claude-reply .inline-actions a.del-action:hover { color: var(--del-text); background: var(--del-line-bg); }
```

- [ ] **Step 7: Verify build passes**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: No errors. Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/style.css
git commit -m "tighten comment box sizing and add reply/resolve styles"
```

---

### Task 3: Update saved user comment HTML in diff.ts

**Files:**
- Modify: `frontend/src/diff.ts`

- [ ] **Step 1: Update saved comment rendering in renderDiff**

In `frontend/src/diff.ts`, find the saved comment block (around line 178-189):

```typescript
    if (comments[lineKey]) {
      html += `<tr class="comment-row" id="cr-${lineId}">
        <td colspan="3">
          <div class="comment-box">
            <div class="saved-comment" data-edit-comment="${lineId}">
              ${escapeHtml(comments[lineKey])}
              <span class="edit-hint">click to edit</span>
            </div>
          </div>
        </td>
      </tr>`;
    }
```

Replace with:

```typescript
    if (comments[lineKey]) {
      html += `<tr class="comment-row" id="cr-${lineId}">
        <td colspan="3">
          <div class="comment-box">
            <div class="saved-comment" data-edit-comment="${lineId}">
              <span class="comment-text">${escapeHtml(comments[lineKey])}</span>
              <span class="inline-actions">
                <a>edit</a>
                <a class="del-action" data-delete-comment="${lineId}">delete</a>
              </span>
            </div>
          </div>
        </td>
      </tr>`;
    }
```

- [ ] **Step 2: Add delete-comment click handler in handleDiffContainerClick**

In `handleDiffContainerClick` (around line 282), add this case before the existing `data-edit-comment` handler:

```typescript
  // Delete comment via inline action
  const deleteCommentEl = target.closest<HTMLElement>('[data-delete-comment]');
  if (deleteCommentEl) {
    const lineId = deleteCommentEl.dataset.deleteComment!;
    const lineKey = lineIdToKey(lineId);
    if (lineKey) delete comments[lineKey];
    renderDiff(activeFileIdx);
    renderFileList();
    return;
  }
```

Add `lineIdToKey` to the imports at the top of `diff.ts`:

```typescript
import {
  files, activeFileIdx, comments, claudeComments,
  getLineId, lineIdToKey,
  setActiveFileIdx, setWholeFileView, setClaudeComments,
  type DiffFile,
} from './state';
```

Also add `renderFileList` to the ui imports. Check if it's already imported — if not, add it:

```typescript
import { renderFileList } from './ui';
```

Note: there may be a circular import issue since `ui.ts` imports from `diff.ts`. If so, import `renderFileList` dynamically inside the handler instead:

```typescript
  const { renderFileList } = await import('./ui');
```

Actually, `renderFileList` is already used in `comments.ts` which imports from `ui.ts`, and `ui.ts` imports from `diff.ts`, so the circular import already exists and works. Just add the static import.

- [ ] **Step 3: Verify build passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/diff.ts
git commit -m "update user comment HTML to tight card with inline actions"
```

---

### Task 4: Update Claude comment HTML in diff.ts with reply/resolve/dismiss

**Files:**
- Modify: `frontend/src/diff.ts`

- [ ] **Step 1: Add resolvedComments import**

Add `resolvedComments` to the state import in `frontend/src/diff.ts`:

```typescript
import {
  files, activeFileIdx, comments, claudeComments, resolvedComments,
  getLineId, lineIdToKey,
  setActiveFileIdx, setWholeFileView, setClaudeComments,
  type DiffFile,
} from './state';
```

- [ ] **Step 2: Create a helper function for rendering Claude comments**

Add this function before `renderDiff` in `frontend/src/diff.ts`:

```typescript
function renderClaudeCommentHtml(cc: { comment: string; _item: string; _serverIndex: number }, ccIdx: number): string {
  const ccKey = `claude:${cc._item}:${cc._serverIndex}`;
  const isResolved = resolvedComments.has(ccKey);
  const replyText = comments[ccKey];

  let inner = `<div class="claude-header">
      <span class="claude-label">Claude</span>
      <span class="claude-text">${escapeHtml(cc.comment)}</span>`;

  if (isResolved) {
    inner += `<span class="resolve-badge">Resolved</span>
      <span class="inline-actions"><a data-unresolve-claude="${ccIdx}">unresolve</a></span>`;
  } else {
    inner += `<span class="inline-actions">
        <a data-reply-claude="${ccIdx}">reply</a>
        <a data-resolve-claude="${ccIdx}">resolve</a>
        <a data-dismiss-claude="${ccIdx}">dismiss</a>
      </span>`;
  }
  inner += `</div>`;

  // Show saved reply
  if (replyText) {
    inner += `<div class="claude-reply" data-edit-reply="${ccIdx}">
      <span class="reply-label">You</span>
      <span class="reply-text">${escapeHtml(replyText)}</span>
      <span class="inline-actions">
        <a>edit</a>
        <a class="del-action" data-delete-reply="${ccIdx}">delete</a>
      </span>
    </div>`;
  }

  return `<div class="claude-comment${isResolved ? ' resolved' : ''}">${inner}</div>`;
}
```

- [ ] **Step 3: Update inline Claude comment rendering in renderDiff**

Find the Claude comment rendering block (around lines 163-176):

```typescript
    for (const cc of claudeForLine) {
      const ccIdx = claudeComments.indexOf(cc);
      html += `<tr class="claude-comment-row">
        <td colspan="3">
          <div class="comment-box" style="max-width:calc(100vw - 360px)">
            <div class="claude-comment">
              <span class="claude-label">Claude</span>
              <span class="claude-dismiss" data-dismiss-claude="${ccIdx}" title="Dismiss">&times;</span>
              ${escapeHtml(cc.comment)}
            </div>
          </div>
        </td>
      </tr>`;
    }
```

Replace with:

```typescript
    for (const cc of claudeForLine) {
      const ccIdx = claudeComments.indexOf(cc);
      html += `<tr class="claude-comment-row">
        <td colspan="3">
          <div class="comment-box" style="max-width:calc(100vw - 360px)">
            ${renderClaudeCommentHtml(cc, ccIdx)}
          </div>
        </td>
      </tr>`;
    }
```

- [ ] **Step 4: Update orphaned Claude comment rendering**

Find the orphaned comment rendering (around lines 237-249):

```typescript
    const tr = document.createElement('tr');
    tr.className = 'claude-comment-row';
    tr.innerHTML = `
      <td colspan="3">
        <div class="comment-box" style="max-width:calc(100vw - 360px)">
          <div class="claude-comment">
            <span class="claude-label">Claude &middot; line ${targetLine}${side === 'old' ? ' (old)' : ''}</span>
            <span class="claude-dismiss" data-dismiss-claude="${ccIdx}" title="Dismiss">&times;</span>
            ${escapeHtml(cc.comment)}
          </div>
        </div>
      </td>
    `;
```

Replace with:

```typescript
    const tr = document.createElement('tr');
    tr.className = 'claude-comment-row';
    tr.innerHTML = `
      <td colspan="3">
        <div class="comment-box" style="max-width:calc(100vw - 360px)">
          ${renderClaudeCommentHtml(cc, ccIdx)}
        </div>
      </td>
    `;
```

Note: this loses the ` · line N` label for orphaned comments. That's an acceptable tradeoff for now — the comment appears near the right location via anchoring. If needed later, the helper can be extended to accept an optional label parameter.

- [ ] **Step 5: Update whole-file view Claude comment rendering**

Find the Claude comments in `showWholeFile` (around lines 400-413):

```typescript
      for (const cc of commentsByLine[l.num] || []) {
        const ccIdx = claudeComments.indexOf(cc);
        html += `<tr class="claude-comment-row">
          <td colspan="3">
            <div class="comment-box" style="max-width:calc(100vw - 360px)">
              <div class="claude-comment">
                <span class="claude-label">Claude</span>
                <span class="claude-dismiss" data-dismiss-claude="${ccIdx}" title="Dismiss">&times;</span>
                ${escapeHtml(cc.comment)}
              </div>
            </div>
          </td>
        </tr>`;
      }
```

Replace with:

```typescript
      for (const cc of commentsByLine[l.num] || []) {
        const ccIdx = claudeComments.indexOf(cc);
        html += `<tr class="claude-comment-row">
          <td colspan="3">
            <div class="comment-box" style="max-width:calc(100vw - 360px)">
              ${renderClaudeCommentHtml(cc, ccIdx)}
            </div>
          </td>
        </tr>`;
      }
```

- [ ] **Step 6: Verify build passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/diff.ts
git commit -m "render Claude comments with reply/resolve/dismiss actions"
```

---

### Task 5: Add click handlers for reply, resolve, unresolve, and reply editing in diff.ts

**Files:**
- Modify: `frontend/src/diff.ts`

- [ ] **Step 1: Replace the dismiss handler and add new handlers in handleDiffContainerClick**

In `handleDiffContainerClick`, replace the existing dismiss handler (around lines 285-296) and add the new handlers. The full updated section should be:

```typescript
  // Dismiss Claude comment
  const dismissEl = target.closest<HTMLElement>('[data-dismiss-claude]');
  if (dismissEl) {
    const idx = parseInt(dismissEl.dataset.dismissClaude!);
    const cc = claudeComments[idx];
    if (cc) {
      deleteClaudeComment(cc._item, cc._serverIndex);
      setClaudeComments(claudeComments.filter((_, i) => i !== idx));
      renderDiff(activeFileIdx);
    }
    return;
  }

  // Resolve Claude comment
  const resolveEl = target.closest<HTMLElement>('[data-resolve-claude]');
  if (resolveEl) {
    const idx = parseInt(resolveEl.dataset.resolveClaude!);
    const cc = claudeComments[idx];
    if (cc) {
      resolvedComments.add(`claude:${cc._item}:${cc._serverIndex}`);
      renderDiff(activeFileIdx);
    }
    return;
  }

  // Unresolve Claude comment
  const unresolveEl = target.closest<HTMLElement>('[data-unresolve-claude]');
  if (unresolveEl) {
    const idx = parseInt(unresolveEl.dataset.unresolveClaude!);
    const cc = claudeComments[idx];
    if (cc) {
      resolvedComments.delete(`claude:${cc._item}:${cc._serverIndex}`);
      renderDiff(activeFileIdx);
    }
    return;
  }

  // Reply to Claude comment
  const replyEl = target.closest<HTMLElement>('[data-reply-claude]');
  if (replyEl) {
    const idx = parseInt(replyEl.dataset.replyClaude!);
    const cc = claudeComments[idx];
    if (cc) openReplyTextarea(idx, cc);
    return;
  }

  // Edit reply
  const editReplyEl = target.closest<HTMLElement>('[data-edit-reply]');
  if (editReplyEl) {
    const idx = parseInt(editReplyEl.dataset.editReply!);
    const cc = claudeComments[idx];
    if (cc) openReplyTextarea(idx, cc);
    return;
  }

  // Delete reply
  const deleteReplyEl = target.closest<HTMLElement>('[data-delete-reply]');
  if (deleteReplyEl) {
    const idx = parseInt(deleteReplyEl.dataset.deleteReply!);
    const cc = claudeComments[idx];
    if (cc) {
      delete comments[`claude:${cc._item}:${cc._serverIndex}`];
      renderDiff(activeFileIdx);
      renderFileList();
    }
    return;
  }
```

- [ ] **Step 2: Add the openReplyTextarea function**

Add this function after `handleDiffContainerClick` in `frontend/src/diff.ts`:

```typescript
function openReplyTextarea(ccIdx: number, cc: { _item: string; _serverIndex: number }): void {
  const ccKey = `claude:${cc._item}:${cc._serverIndex}`;
  const existing = comments[ccKey] || '';

  // Find the claude-comment element for this index
  const commentEl = document.querySelector(`[data-reply-claude="${ccIdx}"], [data-edit-reply="${ccIdx}"]`)
    ?.closest('.claude-comment');
  if (!commentEl) return;

  // Remove existing reply element if present
  const existingReply = commentEl.querySelector('.claude-reply');
  if (existingReply) existingReply.remove();

  // Remove existing textarea if present
  const existingTextarea = commentEl.querySelector('.reply-textarea-wrap');
  if (existingTextarea) existingTextarea.remove();

  const wrap = document.createElement('div');
  wrap.className = 'reply-textarea-wrap';
  wrap.innerHTML = `
    <textarea class="reply-input" style="width:100%;min-height:36px;padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;resize:vertical;outline:none;font-family:inherit;">${escapeHtml(existing)}</textarea>
    <div class="comment-actions" style="margin-top:4px">
      <button class="cancel-btn" data-action="cancel-reply">Cancel</button>
      <button class="save-btn" data-action="save-reply" data-cc-key="${ccKey}">Save</button>
    </div>
  `;

  commentEl.appendChild(wrap);
  const textarea = wrap.querySelector('textarea')!;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { wrap.remove(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Enter' && e.metaKey) { saveReply(ccKey, textarea.value, wrap); e.preventDefault(); e.stopPropagation(); }
  });
  textarea.addEventListener('click', (e) => e.stopPropagation());
  wrap.querySelector('[data-action="cancel-reply"]')!.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
  wrap.querySelector('[data-action="save-reply"]')!.addEventListener('click', (e) => { e.stopPropagation(); saveReply(ccKey, textarea.value, wrap); });
}

function saveReply(ccKey: string, text: string, wrap: Element): void {
  const trimmed = text.trim();
  if (trimmed) {
    comments[ccKey] = trimmed;
  } else {
    delete comments[ccKey];
  }
  renderDiff(activeFileIdx);
  renderFileList();
}
```

- [ ] **Step 3: Verify build passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/diff.ts
git commit -m "add click handlers for reply, resolve, unresolve, dismiss"
```

---

### Task 6: Update document.ts Claude comment rendering

**Files:**
- Modify: `frontend/src/document.ts`

- [ ] **Step 1: Add resolvedComments import**

In `frontend/src/document.ts`, add `resolvedComments` to the state import:

```typescript
import {
  comments, claudeComments, activeItemId, resolvedComments,
  mdMeta, setMdMeta, setClaudeComments, type MdMeta,
} from './state';
```

- [ ] **Step 2: Add renderClaudeCommentHtml helper**

Add this function after the `mdCommentId` function (around line 33) in `frontend/src/document.ts`:

```typescript
function renderClaudeCommentHtml(cc: { comment: string; _item: string; _serverIndex: number }, ccIdx: number): string {
  const ccKey = `claude:${cc._item}:${cc._serverIndex}`;
  const isResolved = resolvedComments.has(ccKey);
  const replyText = comments[ccKey];

  let inner = `<div class="claude-header">
      <span class="claude-label">Claude</span>
      <span class="claude-text">${escapeHtml(cc.comment)}</span>`;

  if (isResolved) {
    inner += `<span class="resolve-badge">Resolved</span>
      <span class="inline-actions"><a data-unresolve-claude-md="${ccIdx}">unresolve</a></span>`;
  } else {
    inner += `<span class="inline-actions">
        <a data-reply-claude-md="${ccIdx}">reply</a>
        <a data-resolve-claude-md="${ccIdx}">resolve</a>
        <a data-dismiss-claude-md="${ccIdx}">dismiss</a>
      </span>`;
  }
  inner += `</div>`;

  if (replyText) {
    inner += `<div class="claude-reply" data-edit-reply-md="${ccIdx}">
      <span class="reply-label">You</span>
      <span class="reply-text">${escapeHtml(replyText)}</span>
      <span class="inline-actions">
        <a>edit</a>
        <a class="del-action" data-delete-reply-md="${ccIdx}">delete</a>
      </span>
    </div>`;
  }

  return `<div class="claude-comment${isResolved ? ' resolved' : ''}">${inner}</div>`;
}
```

- [ ] **Step 3: Update Claude comment rendering in renderMarkdown**

Find the Claude comment HTML generation in `renderMarkdown` (around lines 52-62):

```typescript
    for (const cc of claudeForBlock) {
      const ccIdx = claudeComments.indexOf(cc);
      claudeHtml += `<div class="md-comment" style="margin:4px 0">
        <div class="comment-box" style="max-width:100%">
          <div class="claude-comment">
            <span class="claude-label">Claude</span>
            <span class="claude-dismiss" data-dismiss-claude-md="${ccIdx}" title="Dismiss">&times;</span>
            ${escapeHtml(cc.comment)}
          </div>
        </div>
      </div>`;
    }
```

Replace with:

```typescript
    for (const cc of claudeForBlock) {
      const ccIdx = claudeComments.indexOf(cc);
      claudeHtml += `<div class="md-comment" style="margin:4px 0">
        <div class="comment-box" style="max-width:100%">
          ${renderClaudeCommentHtml(cc, ccIdx)}
        </div>
      </div>`;
    }
```

- [ ] **Step 4: Update saved user comment rendering in renderMarkdown**

Find the saved comment HTML (around lines 67-76):

```typescript
    if (hasComment) {
      html += `<div class="md-comment" id="${mdCommentId(blockIdx)}">
        <div class="comment-box">
          <div class="saved-comment" data-edit-md-comment="${blockIdx}">
            ${escapeHtml(comments[key])}
            <span class="edit-hint">click to edit</span>
          </div>
        </div>
      </div>`;
    }
```

Replace with:

```typescript
    if (hasComment) {
      html += `<div class="md-comment" id="${mdCommentId(blockIdx)}">
        <div class="comment-box">
          <div class="saved-comment" data-edit-md-comment="${blockIdx}">
            <span class="comment-text">${escapeHtml(comments[key])}</span>
            <span class="inline-actions">
              <a>edit</a>
              <a class="del-action" data-delete-md-comment="${blockIdx}">delete</a>
            </span>
          </div>
        </div>
      </div>`;
    }
```

- [ ] **Step 5: Update renderMarkdownComments saved comment HTML**

Find the saved comment HTML in `renderMarkdownComments` (around lines 115-126):

```typescript
    if (comments[key]) {
      const div = document.createElement('div');
      div.className = 'md-comment';
      div.id = mdCommentId(idx);
      div.innerHTML = `
        <div class="comment-box">
          <div class="saved-comment" data-edit-md-comment="${idx}">
            ${escapeHtml(comments[key])}
            <span class="edit-hint">click to edit</span>
          </div>
        </div>
      `;
```

Replace the innerHTML with:

```typescript
    if (comments[key]) {
      const div = document.createElement('div');
      div.className = 'md-comment';
      div.id = mdCommentId(idx);
      div.innerHTML = `
        <div class="comment-box">
          <div class="saved-comment" data-edit-md-comment="${idx}">
            <span class="comment-text">${escapeHtml(comments[key])}</span>
            <span class="inline-actions">
              <a>edit</a>
              <a class="del-action" data-delete-md-comment="${idx}">delete</a>
            </span>
          </div>
        </div>
      `;
```

- [ ] **Step 6: Replace dismiss handler with resolve/reply/dismiss handlers**

Find the dismiss click handler in `renderMarkdown` (around lines 92-103):

```typescript
  container.querySelectorAll<HTMLElement>('[data-dismiss-claude-md]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.dismissClaudeMd!);
      const cc = claudeComments[idx];
      if (cc) {
        deleteClaudeComment(cc._item, cc._serverIndex);
        setClaudeComments(claudeComments.filter((_, i) => i !== idx));
        renderMarkdown({ ...mdMeta, content: mdMeta.content || '' });
      }
    });
  });
```

Replace with:

```typescript
  // Dismiss Claude comment
  container.querySelectorAll<HTMLElement>('[data-dismiss-claude-md]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.dismissClaudeMd!);
      const cc = claudeComments[idx];
      if (cc) {
        deleteClaudeComment(cc._item, cc._serverIndex);
        setClaudeComments(claudeComments.filter((_, i) => i !== idx));
        renderMarkdown({ ...mdMeta, content: mdMeta.content || '' });
      }
    });
  });

  // Resolve Claude comment
  container.querySelectorAll<HTMLElement>('[data-resolve-claude-md]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.resolveClaudeMd!);
      const cc = claudeComments[idx];
      if (cc) {
        resolvedComments.add(`claude:${cc._item}:${cc._serverIndex}`);
        renderMarkdown({ ...mdMeta, content: mdMeta.content || '' });
      }
    });
  });

  // Unresolve Claude comment
  container.querySelectorAll<HTMLElement>('[data-unresolve-claude-md]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.unresolveClaudeMd!);
      const cc = claudeComments[idx];
      if (cc) {
        resolvedComments.delete(`claude:${cc._item}:${cc._serverIndex}`);
        renderMarkdown({ ...mdMeta, content: mdMeta.content || '' });
      }
    });
  });

  // Reply to Claude comment
  container.querySelectorAll<HTMLElement>('[data-reply-claude-md]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.replyClaudeMd!);
      const cc = claudeComments[idx];
      if (cc) openMdReplyTextarea(idx, cc);
    });
  });

  // Edit reply
  container.querySelectorAll<HTMLElement>('[data-edit-reply-md]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.editReplyMd!);
      const cc = claudeComments[idx];
      if (cc) openMdReplyTextarea(idx, cc);
    });
  });

  // Delete reply
  container.querySelectorAll<HTMLElement>('[data-delete-reply-md]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.deleteReplyMd!);
      const cc = claudeComments[idx];
      if (cc) {
        delete comments[`claude:${cc._item}:${cc._serverIndex}`];
        renderMarkdown({ ...mdMeta, content: mdMeta.content || '' });
      }
    });
  });

  // Delete user comment via inline action
  container.querySelectorAll<HTMLElement>('[data-delete-md-comment]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const blockIdx = parseInt(el.dataset.deleteMdComment!);
      const key = mdKey(blockIdx);
      delete comments[key];
      renderMarkdownComments();
    });
  });
```

- [ ] **Step 7: Add the openMdReplyTextarea function**

Add this function at the end of `frontend/src/document.ts`:

```typescript
function openMdReplyTextarea(ccIdx: number, cc: { _item: string; _serverIndex: number }): void {
  const ccKey = `claude:${cc._item}:${cc._serverIndex}`;
  const existing = comments[ccKey] || '';

  const commentEl = document.querySelector(`[data-reply-claude-md="${ccIdx}"], [data-edit-reply-md="${ccIdx}"]`)
    ?.closest('.claude-comment');
  if (!commentEl) return;

  const existingReply = commentEl.querySelector('.claude-reply');
  if (existingReply) existingReply.remove();
  const existingTextarea = commentEl.querySelector('.reply-textarea-wrap');
  if (existingTextarea) existingTextarea.remove();

  const wrap = document.createElement('div');
  wrap.className = 'reply-textarea-wrap';
  wrap.innerHTML = `
    <textarea class="reply-input" style="width:100%;min-height:36px;padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;resize:vertical;outline:none;font-family:inherit;" onclick="event.stopPropagation()">${escapeHtml(existing)}</textarea>
    <div class="comment-actions" style="margin-top:4px">
      <button class="cancel-btn" data-action="cancel-reply">Cancel</button>
      <button class="save-btn" data-action="save-reply">Save</button>
    </div>
  `;

  commentEl.appendChild(wrap);
  const textarea = wrap.querySelector('textarea')!;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  textarea.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { wrap.remove(); e.preventDefault(); }
    else if (e.key === 'Enter' && e.metaKey) { saveMdReply(ccKey, textarea.value); e.preventDefault(); }
  });
  wrap.querySelector('[data-action="cancel-reply"]')!.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
  wrap.querySelector('[data-action="save-reply"]')!.addEventListener('click', (e) => { e.stopPropagation(); saveMdReply(ccKey, textarea.value); });
}

function saveMdReply(ccKey: string, text: string): void {
  const trimmed = text.trim();
  if (trimmed) comments[ccKey] = trimmed;
  else delete comments[ccKey];
  renderMarkdown({ ...mdMeta, content: mdMeta.content || '' });
}
```

- [ ] **Step 8: Verify build passes**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/document.ts
git commit -m "update document view with tight cards and reply/resolve for Claude comments"
```

---

### Task 7: Update formatAllComments output to include Claude comment interactions

**Files:**
- Modify: `frontend/src/comments.ts`

- [ ] **Step 1: Add claudeComments and resolvedComments imports**

Update the imports at the top of `frontend/src/comments.ts`:

```typescript
import {
  comments, files, activeFileIdx, claudeComments, resolvedComments,
  sessionItems,
  lineIdToKey,
} from './state';
```

- [ ] **Step 2: Add formatClaudeInteractions helper**

Add this function after the existing `formatDiffComments` function (around line 149):

```typescript
function formatClaudeInteractions(): string {
  const byFile: Record<string, { lineNum: number | string; comment: string; reply?: string; resolved: boolean }[]> = {};

  for (const cc of claudeComments) {
    if (cc.file == null || cc._item !== 'diff') continue;
    const ccKey = `claude:${cc._item}:${cc._serverIndex}`;
    const reply = comments[ccKey];
    const resolved = resolvedComments.has(ccKey);

    // Skip dismissed (not in claudeComments anymore) and untouched comments
    if (!reply && !resolved) continue;

    const filePath = cc.file;
    if (!byFile[filePath]) byFile[filePath] = [];
    byFile[filePath].push({
      lineNum: cc.line ?? '?',
      comment: cc.comment,
      reply,
      resolved,
    });
  }

  let output = '';
  for (const [filePath, interactions] of Object.entries(byFile)) {
    // Check if this file already has a header from formatDiffComments
    // We'll merge them in formatAllComments instead
    output += `## ${filePath}\n\n`;
    for (const c of interactions.sort((a, b) => Number(a.lineNum) - Number(b.lineNum))) {
      output += `**Claude:** ${c.comment}\n`;
      if (c.reply) {
        output += `**Reply:** ${c.reply}\n`;
      } else if (c.resolved) {
        output += `**Status:** Resolved\n`;
      }
      output += '\n';
    }
  }
  return output;
}

function formatDocClaudeInteractions(): string {
  let output = '';
  for (const item of sessionItems) {
    if (item.id === 'diff') continue;
    const itemComments = claudeComments.filter(cc => cc._item === item.id);
    const interactions: { block: number; comment: string; reply?: string; resolved: boolean }[] = [];

    for (const cc of itemComments) {
      const ccKey = `claude:${cc._item}:${cc._serverIndex}`;
      const reply = comments[ccKey];
      const resolved = resolvedComments.has(ccKey);
      if (!reply && !resolved) continue;
      interactions.push({ block: cc.block ?? 0, comment: cc.comment, reply, resolved });
    }

    if (interactions.length === 0) continue;
    output += `## ${item.title}\n\n`;
    for (const c of interactions.sort((a, b) => a.block - b.block)) {
      output += `**Claude:** ${c.comment}\n`;
      if (c.reply) output += `**Reply:** ${c.reply}\n`;
      else if (c.resolved) output += `**Status:** Resolved\n`;
      output += '\n';
    }
  }
  return output;
}
```

- [ ] **Step 3: Update formatAllComments to include Claude interactions**

Replace the `formatAllComments` function:

```typescript
export function formatAllComments(): string {
  let output = '';

  // User's standalone diff comments
  const diffOutput = formatDiffComments();
  if (diffOutput) output += diffOutput;

  // Claude comment interactions (replies and resolves) for diff
  const claudeDiffOutput = formatClaudeInteractions();
  if (claudeDiffOutput) output += claudeDiffOutput;

  // User's standalone document comments
  for (const item of sessionItems) {
    if (item.id === 'diff') continue;
    const docComments = Object.entries(comments).filter(([k]) => k.startsWith(`doc:${item.id}:`));
    if (docComments.length === 0) continue;
    output += `## ${item.title}\n\n`;
    const sorted = docComments.sort((a, b) => {
      const ai = parseInt(a[0].split(':').pop()!);
      const bi = parseInt(b[0].split(':').pop()!);
      return ai - bi;
    });
    for (const [key, text] of sorted) {
      const blockIdx = parseInt(key.split(':').pop()!);
      const blockEl = document.getElementById(`md-block-${item.id}-${blockIdx}`);
      const preview = blockEl?.textContent?.trim()?.slice(0, 80) || `Block ${blockIdx}`;
      output += `**${preview}${preview.length >= 80 ? '...' : ''}**\n`;
      output += `> ${text}\n\n`;
    }
  }

  // Claude comment interactions for documents
  const claudeDocOutput = formatDocClaudeInteractions();
  if (claudeDocOutput) output += claudeDocOutput;

  return output || 'No comments (LGTM).';
}
```

- [ ] **Step 4: Exclude reply keys from formatDiffComments**

In `formatDiffComments`, update the skip condition (around line 124) to also skip claude reply keys:

```typescript
    if (key.startsWith('doc:') || key.startsWith('md::') || key.startsWith('claude:')) continue;
```

- [ ] **Step 5: Verify build passes**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: No errors. Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/comments.ts
git commit -m "include Claude comment replies and resolves in review output"
```

---

### Task 8: Manual testing and final build

- [ ] **Step 1: Build the frontend**

Run: `cd frontend && npm run build`
Expected: Build succeeds, `frontend/dist/` updated.

- [ ] **Step 2: Start the server and test**

Run: `uv run lgtm --repo /Users/tom/dev/claude-review`

Manual testing checklist:
1. User comments render with tight card styling (less padding, smaller radius)
2. Hover over a saved user comment — edit/delete links appear on right
3. Click anywhere on a saved comment — opens edit textarea
4. Click delete link — removes comment without entering edit mode
5. If Claude comments are present: verify reply/resolve/dismiss links appear inline
6. Click reply — textarea opens inside the Claude card
7. Save a reply — shows nested with blue border and "You" label
8. Click on saved reply — opens for editing
9. Click resolve — card fades, "Resolved" badge appears, actions become "unresolve"
10. Click unresolve — card returns to normal
11. Click dismiss — comment disappears
12. Submit review — check output file includes `**Claude:**`/`**Reply:**`/`**Status:** Resolved` format

- [ ] **Step 3: Commit build output**

```bash
git add frontend/dist/
git commit -m "rebuild frontend with comment UX improvements"
```
