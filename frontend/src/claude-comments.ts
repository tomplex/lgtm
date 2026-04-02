import { comments, addLocalComment, updateLocalComment, removeLocalComment } from './state';
import { escapeHtml, renderMd } from './utils';
import { createComment as apiCreateComment, updateComment as apiUpdateComment, deleteComment as apiDeleteComment } from './comment-api';
import type { Comment } from './comment-types';

// --- Helpers ---

function getReplies(parent: Comment): Comment[] {
  return comments.filter(c => c.parentId === parent.id);
}

function findCommentById(id: string): Comment | undefined {
  return comments.find(c => c.id === id);
}

// --- Rendering ---

export function renderCommentHtml(comment: Comment): string {
  const isResolved = comment.status === 'resolved';
  const isDismissed = comment.status === 'dismissed';
  const replies = getReplies(comment);

  let inner = `<div class="claude-header">
      <span class="claude-label">${comment.author === 'claude' ? 'Claude' : 'You'}</span>`;

  if (isResolved) {
    inner += `<span class="resolve-badge">Resolved</span>
      <span class="inline-actions"><a data-unresolve-comment="${comment.id}">unresolve</a></span>`;
  } else if (isDismissed) {
    // dismissed comments are typically hidden, but if rendered show minimal UI
    inner += `<span class="resolve-badge">Dismissed</span>`;
  } else if (comment.author === 'claude') {
    inner += `<span class="inline-actions">
        <a data-reply-comment="${comment.id}">reply</a>
        <a data-resolve-comment="${comment.id}">resolve</a>
        <a data-dismiss-comment="${comment.id}">dismiss</a>
      </span>`;
  } else {
    inner += `<span class="inline-actions">
        <a data-edit-user-comment="${comment.id}">edit</a>
        <a class="del-action" data-delete-user-comment="${comment.id}">delete</a>
      </span>`;
  }
  inner += `</div>`;
  inner += `<div class="claude-text">${renderMd(comment.text)}</div>`;

  for (const reply of replies) {
    inner += `<div class="claude-reply">
      <div class="claude-reply-header">
        <span class="reply-label">${reply.author === 'claude' ? 'Claude' : 'You'}</span>
        <span class="inline-actions">
          <a data-edit-reply="${reply.id}">edit</a>
          <a class="del-action" data-delete-reply="${reply.id}">delete</a>
        </span>
      </div>
      <div class="reply-text">${renderMd(reply.text)}</div>
    </div>`;
  }

  return `<div class="claude-comment${isResolved ? ' resolved' : ''}" data-comment-id="${comment.id}">${inner}</div>`;
}

// --- Interaction handlers (for event delegation) ---

export function handleCommentAction(target: HTMLElement, rerender: () => void): boolean {
  // Dismiss
  const dismissEl = target.closest<HTMLElement>('[data-dismiss-comment]');
  if (dismissEl) {
    const id = dismissEl.dataset.dismissComment!;
    const c = findCommentById(id);
    if (c) {
      updateLocalComment(id, { status: 'dismissed' });
      rerender();
      apiUpdateComment(id, { status: 'dismissed' });
    }
    return true;
  }

  // Resolve
  const resolveEl = target.closest<HTMLElement>('[data-resolve-comment]');
  if (resolveEl) {
    const id = resolveEl.dataset.resolveComment!;
    const c = findCommentById(id);
    if (c) {
      updateLocalComment(id, { status: 'resolved' });
      rerender();
      apiUpdateComment(id, { status: 'resolved' });
    }
    return true;
  }

  // Unresolve
  const unresolveEl = target.closest<HTMLElement>('[data-unresolve-comment]');
  if (unresolveEl) {
    const id = unresolveEl.dataset.unresolveComment!;
    const c = findCommentById(id);
    if (c) {
      updateLocalComment(id, { status: 'active' });
      rerender();
      apiUpdateComment(id, { status: 'active' });
    }
    return true;
  }

  // Reply
  const replyEl = target.closest<HTMLElement>('[data-reply-comment]');
  if (replyEl) {
    const id = replyEl.dataset.replyComment!;
    const c = findCommentById(id);
    if (c) openReplyTextarea(c, rerender);
    return true;
  }

  // Edit reply
  const editReplyEl = target.closest<HTMLElement>('[data-edit-reply]');
  if (editReplyEl) {
    const id = editReplyEl.dataset.editReply!;
    const c = findCommentById(id);
    if (c) openEditTextarea(c, rerender);
    return true;
  }

  // Delete reply
  const deleteReplyEl = target.closest<HTMLElement>('[data-delete-reply]');
  if (deleteReplyEl) {
    const id = deleteReplyEl.dataset.deleteReply!;
    removeLocalComment(id);
    rerender();
    apiDeleteComment(id);
    return true;
  }

  // Edit user comment
  const editUserEl = target.closest<HTMLElement>('[data-edit-user-comment]');
  if (editUserEl) {
    const id = editUserEl.dataset.editUserComment!;
    const c = findCommentById(id);
    if (c) openEditTextarea(c, rerender);
    return true;
  }

  // Delete user comment
  const deleteUserEl = target.closest<HTMLElement>('[data-delete-user-comment]');
  if (deleteUserEl) {
    const id = deleteUserEl.dataset.deleteUserComment!;
    removeLocalComment(id);
    rerender();
    apiDeleteComment(id);
    return true;
  }

  return false;
}

// --- Reply textarea ---

export function openReplyTextarea(parent: Comment, rerender: () => void): void {
  const commentEl = document.querySelector(`[data-comment-id="${parent.id}"]`);
  if (!commentEl) return;

  const existingTextarea = commentEl.querySelector('.reply-textarea-wrap');
  if (existingTextarea) existingTextarea.remove();

  const wrap = document.createElement('div');
  wrap.className = 'reply-textarea-wrap';
  wrap.innerHTML = `
    <textarea class="reply-input" style="width:100%;min-height:36px;padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;resize:vertical;outline:none;font-family:inherit;"></textarea>
    <div class="comment-actions" style="margin-top:4px">
      <button class="cancel-btn" data-action="cancel-reply">Cancel</button>
      <button class="save-btn" data-action="save-reply">Save</button>
    </div>
  `;

  commentEl.appendChild(wrap);
  const textarea = wrap.querySelector('textarea')!;
  textarea.focus();

  const save = async () => {
    const trimmed = textarea.value.trim();
    if (!trimmed) { wrap.remove(); return; }
    const tempId = `temp-${Date.now()}`;
    const localComment: Comment = {
      id: tempId,
      author: 'user',
      text: trimmed,
      status: 'active',
      parentId: parent.id,
      item: parent.item,
      file: parent.file,
      line: parent.line,
      block: parent.block,
    };
    addLocalComment(localComment);
    rerender();
    try {
      const created = await apiCreateComment({
        author: 'user',
        text: trimmed,
        item: parent.item,
        parentId: parent.id,
        file: parent.file,
        line: parent.line,
        block: parent.block,
      });
      updateLocalComment(tempId, { id: created.id });
    } catch { /* optimistic update already applied */ }
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

// --- Edit textarea ---

export function openEditTextarea(comment: Comment, rerender: () => void): void {
  const commentEl = document.querySelector(`[data-comment-id="${comment.id}"]`)
    || document.querySelector(`[data-edit-reply="${comment.id}"]`)?.closest('.claude-reply');
  if (!commentEl) return;

  const existingTextarea = commentEl.querySelector('.reply-textarea-wrap');
  if (existingTextarea) existingTextarea.remove();

  const wrap = document.createElement('div');
  wrap.className = 'reply-textarea-wrap';
  wrap.innerHTML = `
    <textarea class="reply-input" style="width:100%;min-height:36px;padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;resize:vertical;outline:none;font-family:inherit;">${escapeHtml(comment.text)}</textarea>
    <div class="comment-actions" style="margin-top:4px">
      <button class="cancel-btn" data-action="cancel-reply">Cancel</button>
      <button class="save-btn" data-action="save-reply">Save</button>
    </div>
  `;

  commentEl.appendChild(wrap);
  const textarea = wrap.querySelector('textarea')!;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const save = async () => {
    const trimmed = textarea.value.trim();
    if (!trimmed) { wrap.remove(); return; }
    updateLocalComment(comment.id, { text: trimmed });
    rerender();
    try {
      await apiUpdateComment(comment.id, { text: trimmed });
    } catch { /* optimistic update already applied */ }
  };

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      rerender();
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
    rerender();
  });
  wrap.querySelector('[data-action="save-reply"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    save();
  });
}
