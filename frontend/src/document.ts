import {
  comments,
  activeItemId,
  mdMeta,
  setMdMeta,
  type MdMeta,
  addLocalComment,
} from './state';
import { renderMd } from './utils';
import { renderCommentHtml, handleCommentAction } from './claude-comments';
import { createComment as apiCreateComment } from './comment-api';

function mdBlockId(blockIdx: number): string {
  return `md-block-${activeItemId}-${blockIdx}`;
}

function mdCommentId(blockIdx: number): string {
  return `md-comment-${activeItemId}-${blockIdx}`;
}


export function renderMarkdown(data: MdMeta & { content: string; claudeComments?: any[] }): void {
  setMdMeta(data);
  const container = document.getElementById('diff-container')!;

  const rawHtml = renderMd(data.content);
  const temp = document.createElement('div');
  temp.innerHTML = rawHtml;

  let html = '';
  let blockIdx = 0;
  for (const child of Array.from(temp.children)) {
    const blockComments = comments.filter(c =>
      c.item === activeItemId && c.block === blockIdx && !c.parentId && c.status !== 'dismissed'
    );
    const hasComment = blockComments.length > 0;

    let commentHtml = '';
    for (const comment of blockComments) {
      commentHtml += `<div class="md-comment" style="margin:4px 0">
        <div class="comment-box" style="max-width:100%">
          ${renderCommentHtml(comment)}
        </div>
      </div>`;
    }

    html += `<div class="md-block ${hasComment ? 'has-comment' : ''}" id="${mdBlockId(blockIdx)}" data-block="${blockIdx}">${child.outerHTML}</div>`;
    html += commentHtml;
    blockIdx++;
  }

  container.innerHTML = `<div class="md-content">${html}</div>`;

  // Single delegated click handler for all interactive elements
  container.addEventListener('click', handleMdContainerClick);

  updateMdStats();
}

function handleMdContainerClick(e: Event): void {
  const target = e.target as HTMLElement;

  // Comment actions (dismiss, resolve, unresolve, reply, edit, delete)
  const rerenderMd = () => renderMarkdown({ ...mdMeta, content: mdMeta.content || '' });
  if (handleCommentAction(target, rerenderMd)) return;

  // Block click -> toggle comment (skip if clicking inside a comment or textarea)
  if (target.closest('.md-comment') || target.closest('.reply-textarea-wrap')) return;
  const blockEl = target.closest<HTMLElement>('.md-block[data-block]');
  if (blockEl) {
    toggleMdComment(parseInt(blockEl.dataset.block!));
    return;
  }
}

export function renderMarkdownComments(): void {
  document.querySelectorAll<HTMLElement>('.md-block').forEach((el) => {
    const idx = parseInt(el.dataset.block!);
    const blockComments = comments.filter(c =>
      c.item === activeItemId && c.block === idx && !c.parentId && c.status !== 'dismissed'
    );
    const hasComment = blockComments.length > 0;
    el.classList.toggle('has-comment', hasComment);
    const existing = document.getElementById(mdCommentId(idx));
    if (existing) existing.remove();
    for (const comment of blockComments) {
      const div = document.createElement('div');
      div.className = 'md-comment';
      div.id = mdCommentId(idx);
      div.innerHTML = `
        <div class="comment-box" style="max-width:100%">
          ${renderCommentHtml(comment)}
        </div>
      `;
      el.after(div);
    }
  });
  updateMdStats();
}

function updateMdStats(): void {
  const count = comments.filter(c => c.item === activeItemId && !c.parentId && c.status !== 'dismissed').length;
  document.getElementById('stats')!.innerHTML =
    `${mdMeta.filename || 'Document'}` + (count > 0 ? ` &middot; ${count} comment${count !== 1 ? 's' : ''}` : '');
}

function toggleMdComment(blockIdx: number): void {
  const existingComment = comments.find(c =>
    c.item === activeItemId && c.block === blockIdx && !c.parentId && c.author === 'user' && c.mode === 'review'
  );
  if (existingComment) {
    // existing user comment — open edit flow via renderCommentHtml's data attributes
    // handleCommentAction will handle edits; just focus the block's comment element
    const commentEl = document.querySelector<HTMLElement>(`[data-comment-id="${existingComment.id}"]`);
    if (commentEl) {
      commentEl.scrollIntoView({ block: 'nearest' });
    }
    return;
  }

  const existing = document.getElementById(mdCommentId(blockIdx));
  if (existing) {
    existing.querySelector('textarea')?.focus();
    return;
  }

  const block = document.getElementById(mdBlockId(blockIdx));
  if (!block) return;

  const div = document.createElement('div');
  div.className = 'md-comment';
  div.id = mdCommentId(blockIdx);
  div.innerHTML = `
    <div class="comment-box">
      <textarea placeholder="Leave a comment..." autofocus></textarea>
      <div class="comment-actions">
        <button class="cancel-btn" data-action="cancel">Cancel</button>
        <button class="save-btn" data-action="save">Save</button>
      </div>
    </div>
  `;

  const rerenderMd = () => renderMarkdown({ ...mdMeta, content: mdMeta.content || '' });

  const textarea = div.querySelector('textarea')!;
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      div.remove();
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Enter' && e.metaKey) {
      saveMdComment(blockIdx, div, rerenderMd);
      e.preventDefault();
      e.stopPropagation();
    }
  });
  textarea.addEventListener('click', (e) => e.stopPropagation());
  div.querySelector('[data-action="cancel"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    div.remove();
  });
  div.querySelector('[data-action="save"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    saveMdComment(blockIdx, div, rerenderMd);
  });

  block.after(div);
  textarea.focus();
}

async function saveMdComment(blockIdx: number, div: HTMLElement, rerender: () => void): Promise<void> {
  const text = div.querySelector('textarea')?.value?.trim();
  if (!text) {
    div.remove();
    return;
  }
  div.remove();
  const comment = await apiCreateComment({
    author: 'user', text, item: activeItemId, block: blockIdx, mode: 'review'
  });
  addLocalComment(comment);
  rerender();
}
