import {
  comments,
  claudeComments,
  activeItemId,
  mdMeta,
  setMdMeta,
  type MdMeta,
} from './state';
import { escapeHtml, renderMd } from './utils';
import { saveState } from './persistence';
import { renderClaudeCommentHtml, handleClaudeCommentAction } from './claude-comments';

function mdKey(blockIdx: number): string {
  return activeItemId === 'diff' ? `md::${blockIdx}` : `doc:${activeItemId}:${blockIdx}`;
}

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
    const key = mdKey(blockIdx);
    const hasComment = !!comments[key];

    // Claude comments on this block
    const claudeForBlock = claudeComments.filter((c) => c.block === blockIdx);
    let claudeHtml = '';
    for (const cc of claudeForBlock) {
      const ccIdx = claudeComments.indexOf(cc);
      claudeHtml += `<div class="md-comment" style="margin:4px 0">
        <div class="comment-box" style="max-width:100%">
          ${renderClaudeCommentHtml(cc, ccIdx)}
        </div>
      </div>`;
    }

    html += `<div class="md-block ${hasComment ? 'has-comment' : ''}" id="${mdBlockId(blockIdx)}" data-block="${blockIdx}">${child.outerHTML}</div>`;
    html += claudeHtml;
    if (hasComment) {
      html += `<div class="md-comment" id="${mdCommentId(blockIdx)}">
        <div class="comment-box">
          <div class="saved-comment" data-edit-md-comment="${blockIdx}">
            <span class="comment-text">${renderMd(comments[key])}</span>
            <span class="inline-actions">
              <a>edit</a>
              <a class="del-action" data-delete-md-comment="${blockIdx}">delete</a>
            </span>
          </div>
        </div>
      </div>`;
    }
    blockIdx++;
  }

  container.innerHTML = `<div class="md-content">${html}</div>`;

  // Single delegated click handler for all interactive elements
  container.addEventListener('click', handleMdContainerClick);

  updateMdStats();
}

function handleMdContainerClick(e: Event): void {
  const target = e.target as HTMLElement;

  // Claude comment actions (dismiss, resolve, unresolve, reply, edit-reply, delete-reply)
  const rerenderMd = () => renderMarkdown({ ...mdMeta, content: mdMeta.content || '' });
  if (handleClaudeCommentAction(target, rerenderMd)) return;

  // Edit saved comment
  const editEl = target.closest<HTMLElement>('[data-edit-md-comment]');
  if (editEl) {
    editMdComment(parseInt(editEl.dataset.editMdComment!));
    return;
  }

  // Delete user comment
  const deleteEl = target.closest<HTMLElement>('[data-delete-md-comment]');
  if (deleteEl) {
    const blockIdx = parseInt(deleteEl.dataset.deleteMdComment!);
    delete comments[mdKey(blockIdx)];
    renderMarkdownComments();
    return;
  }

  // Block click -> toggle comment (skip if clicking inside a comment or textarea)
  if (target.closest('.md-comment') || target.closest('.reply-textarea-wrap')) return;
  const blockEl = target.closest<HTMLElement>('.md-block[data-block]');
  if (blockEl) {
    toggleMdComment(parseInt(blockEl.dataset.block!));
    return;
  }
}

export function renderMarkdownComments(): void {
  saveState();
  document.querySelectorAll<HTMLElement>('.md-block').forEach((el) => {
    const idx = parseInt(el.dataset.block!);
    const key = mdKey(idx);
    el.classList.toggle('has-comment', !!comments[key]);
    const existing = document.getElementById(mdCommentId(idx));
    if (existing) existing.remove();
    if (comments[key]) {
      const div = document.createElement('div');
      div.className = 'md-comment';
      div.id = mdCommentId(idx);
      div.innerHTML = `
        <div class="comment-box">
          <div class="saved-comment" data-edit-md-comment="${idx}">
            <span class="comment-text">${renderMd(comments[key])}</span>
            <span class="inline-actions">
              <a>edit</a>
              <a class="del-action" data-delete-md-comment="${idx}">delete</a>
            </span>
          </div>
        </div>
      `;
      el.after(div);
    }
  });
  updateMdStats();
}

function updateMdStats(): void {
  const prefix = activeItemId === 'diff' ? 'md::' : `doc:${activeItemId}:`;
  const count = Object.keys(comments).filter(k => k.startsWith(prefix)).length;
  document.getElementById('stats')!.innerHTML =
    `${mdMeta.filename || 'Document'}` + (count > 0 ? ` &middot; ${count} comment${count !== 1 ? 's' : ''}` : '');
}

function toggleMdComment(blockIdx: number): void {
  const key = mdKey(blockIdx);
  if (comments[key]) {
    editMdComment(blockIdx);
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

  const textarea = div.querySelector('textarea')!;
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      div.remove();
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Enter' && e.metaKey) {
      saveMdComment(blockIdx);
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
    saveMdComment(blockIdx);
  });

  block.after(div);
  textarea.focus();
}

function editMdComment(blockIdx: number): void {
  const key = mdKey(blockIdx);
  const div = document.getElementById(mdCommentId(blockIdx));
  if (!div) return;

  div.innerHTML = `
    <div class="comment-box">
      <textarea>${escapeHtml(comments[key])}</textarea>
      <div class="comment-actions">
        <button class="cancel-btn" data-action="cancel-edit">Cancel</button>
        <button class="cancel-btn" data-action="delete" style="color: var(--del-text)">Delete</button>
        <button class="save-btn" data-action="save">Save</button>
      </div>
    </div>
  `;

  const textarea = div.querySelector('textarea')!;
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      renderMarkdownComments();
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Enter' && e.metaKey) {
      saveMdComment(blockIdx);
      e.preventDefault();
      e.stopPropagation();
    }
  });
  textarea.addEventListener('click', (e) => e.stopPropagation());
  div.querySelector('[data-action="cancel-edit"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    renderMarkdownComments();
  });
  div.querySelector('[data-action="delete"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    delete comments[key];
    renderMarkdownComments();
  });
  div.querySelector('[data-action="save"]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    saveMdComment(blockIdx);
  });

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function saveMdComment(blockIdx: number): void {
  const key = mdKey(blockIdx);
  const div = document.getElementById(mdCommentId(blockIdx));
  if (!div) return;
  const text = div.querySelector('textarea')?.value?.trim();
  if (!text) delete comments[key];
  else comments[key] = text;
  renderMarkdownComments();
}

