import { comments, claudeComments, resolvedComments, setClaudeComments } from './state';
import { escapeHtml, renderMd } from './utils';
import { deleteClaudeComment } from './api';
import { saveState } from './persistence';

// --- Helpers ---

function ccKey(cc: { id: string }): string {
  return `claude:${cc.id}`;
}

function findById(id: string) {
  return claudeComments.find(c => c.id === id);
}

// --- Rendering ---

export function renderClaudeCommentHtml(
  cc: { id: string; comment: string; _item: string },
): string {
  const key = ccKey(cc);
  const isResolved = resolvedComments.has(key);
  const replyText = comments[key];

  let inner = `<div class="claude-header">
      <span class="claude-label">Claude</span>`;

  if (isResolved) {
    inner += `<span class="resolve-badge">Resolved</span>
      <span class="inline-actions"><a data-unresolve-claude="${cc.id}">unresolve</a></span>`;
  } else {
    inner += `<span class="inline-actions">
        <a data-reply-claude="${cc.id}">reply</a>
        <a data-resolve-claude="${cc.id}">resolve</a>
        <a data-dismiss-claude="${cc.id}">dismiss</a>
      </span>`;
  }
  inner += `</div>`;
  inner += `<div class="claude-text">${renderMd(cc.comment)}</div>`;

  if (replyText) {
    inner += `<div class="claude-reply" data-edit-reply="${cc.id}">
      <div class="claude-reply-header">
        <span class="reply-label">You</span>
        <span class="inline-actions">
          <a>edit</a>
          <a class="del-action" data-delete-reply="${cc.id}">delete</a>
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
    const cc = findById(dismissEl.dataset.dismissClaude!);
    if (cc) {
      deleteClaudeComment(cc._item, cc.id);
      setClaudeComments(claudeComments.filter(c => c.id !== cc.id));
      rerender();
    }
    return true;
  }

  // Resolve
  const resolveEl = target.closest<HTMLElement>('[data-resolve-claude]');
  if (resolveEl) {
    const cc = findById(resolveEl.dataset.resolveClaude!);
    if (cc) {
      resolvedComments.add(ccKey(cc));
      saveState();
      rerender();
    }
    return true;
  }

  // Unresolve
  const unresolveEl = target.closest<HTMLElement>('[data-unresolve-claude]');
  if (unresolveEl) {
    const cc = findById(unresolveEl.dataset.unresolveClaude!);
    if (cc) {
      resolvedComments.delete(ccKey(cc));
      saveState();
      rerender();
    }
    return true;
  }

  // Reply
  const replyEl = target.closest<HTMLElement>('[data-reply-claude]');
  if (replyEl) {
    const cc = findById(replyEl.dataset.replyClaude!);
    if (cc) openReplyTextarea(cc, rerender);
    return true;
  }

  // Edit reply
  const editReplyEl = target.closest<HTMLElement>('[data-edit-reply]');
  if (editReplyEl) {
    const cc = findById(editReplyEl.dataset.editReply!);
    if (cc) openReplyTextarea(cc, rerender);
    return true;
  }

  // Delete reply
  const deleteReplyEl = target.closest<HTMLElement>('[data-delete-reply]');
  if (deleteReplyEl) {
    const cc = findById(deleteReplyEl.dataset.deleteReply!);
    if (cc) {
      delete comments[ccKey(cc)];
      saveState();
      rerender();
    }
    return true;
  }

  return false;
}

// --- Reply textarea ---

function openReplyTextarea(
  cc: { id: string; _item: string },
  rerender: () => void,
): void {
  const key = ccKey(cc);
  const existing = comments[key] || '';

  const commentEl = document
    .querySelector(`[data-reply-claude="${cc.id}"], [data-edit-reply="${cc.id}"]`)
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
    if (trimmed) comments[key] = trimmed;
    else delete comments[key];
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
