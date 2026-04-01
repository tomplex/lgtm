import { comments, claudeComments, resolvedComments, setClaudeComments } from './state';
import { escapeHtml, renderMd } from './utils';
import { deleteClaudeComment } from './api';
import { saveState } from './persistence';

// --- Rendering ---

export function renderClaudeCommentHtml(
  cc: { comment: string; _item: string; _serverIndex: number },
  ccIdx: number,
): string {
  const ccKey = `claude:${cc._item}:${cc._serverIndex}`;
  const isResolved = resolvedComments.has(ccKey);
  const replyText = comments[ccKey];

  let inner = `<div class="claude-header">
      <span class="claude-label">Claude</span>`;

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
  inner += `<div class="claude-text">${renderMd(cc.comment)}</div>`;

  if (replyText) {
    inner += `<div class="claude-reply" data-edit-reply="${ccIdx}">
      <div class="claude-reply-header">
        <span class="reply-label">You</span>
        <span class="inline-actions">
          <a>edit</a>
          <a class="del-action" data-delete-reply="${ccIdx}">delete</a>
        </span>
      </div>
      <div class="reply-text">${renderMd(replyText)}</div>
    </div>`;
  }

  return `<div class="claude-comment${isResolved ? ' resolved' : ''}">${inner}</div>`;
}

// --- Interaction handlers (for event delegation) ---

export function handleClaudeCommentAction(target: HTMLElement, rerender: () => void): boolean {
  // Dismiss
  const dismissEl = target.closest<HTMLElement>('[data-dismiss-claude]');
  if (dismissEl) {
    const idx = parseInt(dismissEl.dataset.dismissClaude!);
    const cc = claudeComments[idx];
    if (cc) {
      deleteClaudeComment(cc._item, cc._serverIndex);
      setClaudeComments(claudeComments.filter((_, i) => i !== idx));
      rerender();
    }
    return true;
  }

  // Resolve
  const resolveEl = target.closest<HTMLElement>('[data-resolve-claude]');
  if (resolveEl) {
    const idx = parseInt(resolveEl.dataset.resolveClaude!);
    const cc = claudeComments[idx];
    if (cc) {
      resolvedComments.add(`claude:${cc._item}:${cc._serverIndex}`);
      saveState();
      rerender();
    }
    return true;
  }

  // Unresolve
  const unresolveEl = target.closest<HTMLElement>('[data-unresolve-claude]');
  if (unresolveEl) {
    const idx = parseInt(unresolveEl.dataset.unresolveClaude!);
    const cc = claudeComments[idx];
    if (cc) {
      resolvedComments.delete(`claude:${cc._item}:${cc._serverIndex}`);
      saveState();
      rerender();
    }
    return true;
  }

  // Reply
  const replyEl = target.closest<HTMLElement>('[data-reply-claude]');
  if (replyEl) {
    const idx = parseInt(replyEl.dataset.replyClaude!);
    const cc = claudeComments[idx];
    if (cc) openReplyTextarea(idx, cc, rerender);
    return true;
  }

  // Edit reply
  const editReplyEl = target.closest<HTMLElement>('[data-edit-reply]');
  if (editReplyEl) {
    const idx = parseInt(editReplyEl.dataset.editReply!);
    const cc = claudeComments[idx];
    if (cc) openReplyTextarea(idx, cc, rerender);
    return true;
  }

  // Delete reply
  const deleteReplyEl = target.closest<HTMLElement>('[data-delete-reply]');
  if (deleteReplyEl) {
    const idx = parseInt(deleteReplyEl.dataset.deleteReply!);
    const cc = claudeComments[idx];
    if (cc) {
      delete comments[`claude:${cc._item}:${cc._serverIndex}`];
      saveState();
      rerender();
    }
    return true;
  }

  return false;
}

// --- Reply textarea ---

function openReplyTextarea(
  ccIdx: number,
  cc: { _item: string; _serverIndex: number },
  rerender: () => void,
): void {
  const ccKey = `claude:${cc._item}:${cc._serverIndex}`;
  const existing = comments[ccKey] || '';

  const commentEl = document
    .querySelector(`[data-reply-claude="${ccIdx}"], [data-edit-reply="${ccIdx}"]`)
    ?.closest('.claude-comment');
  if (!commentEl) return;

  const existingReply = commentEl.querySelector('.claude-reply');
  if (existingReply) existingReply.remove();
  const existingTextarea = commentEl.querySelector('.reply-textarea-wrap');
  if (existingTextarea) existingTextarea.remove();

  const wrap = document.createElement('div');
  wrap.className = 'reply-textarea-wrap';
  wrap.innerHTML = `
    <textarea class="reply-input" style="width:100%;min-height:36px;padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;resize:vertical;outline:none;font-family:inherit;">${escapeHtml(existing)}</textarea>
    <div class="comment-actions" style="margin-top:4px">
      <button class="cancel-btn" data-action="cancel-reply">Cancel</button>
      <button class="save-btn" data-action="save-reply">Save</button>
    </div>
  `;

  commentEl.appendChild(wrap);
  const textarea = wrap.querySelector('textarea')!;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const save = () => {
    const trimmed = textarea.value.trim();
    if (trimmed) comments[ccKey] = trimmed;
    else delete comments[ccKey];
    saveState();
    rerender();
  };

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      wrap.remove();
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Enter' && e.metaKey) {
      save();
      e.preventDefault();
      e.stopPropagation();
    }
  });
  textarea.addEventListener('click', (e) => e.stopPropagation());
  wrap.querySelector('[data-action="cancel-reply"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.remove();
  });
  wrap.querySelector('[data-action="save-reply"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    save();
  });
}
