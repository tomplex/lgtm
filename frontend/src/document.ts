import { Marked } from 'marked';
import hljs from 'highlight.js';
import {
  comments, claudeComments, activeItemId, resolvedComments,
  mdMeta, setMdMeta, setClaudeComments, type MdMeta,
} from './state';
import { escapeHtml } from './utils';
import { deleteClaudeComment } from './api';

const marked = new Marked({
  renderer: {
    // marked v12 passes { text, lang } at runtime but types expect positional args
    code(this: unknown, ...args: unknown[]) {
      const token = (typeof args[0] === 'object' ? args[0] : { text: args[0], lang: args[1] }) as { text: string; lang?: string };
      const highlighted = token.lang && hljs.getLanguage(token.lang)
        ? hljs.highlight(token.text, { language: token.lang, ignoreIllegals: true }).value
        : hljs.highlightAuto(token.text).value;
      return `<pre><code class="hljs">${highlighted}</code></pre>`;
    },
  },
});

function mdKey(blockIdx: number): string {
  return activeItemId === 'diff' ? `md::${blockIdx}` : `doc:${activeItemId}:${blockIdx}`;
}

function mdBlockId(blockIdx: number): string {
  return `md-block-${activeItemId}-${blockIdx}`;
}

function mdCommentId(blockIdx: number): string {
  return `md-comment-${activeItemId}-${blockIdx}`;
}

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

export function renderMarkdown(data: MdMeta & { content: string; claudeComments?: any[] }): void {
  setMdMeta(data);
  const container = document.getElementById('diff-container')!;

  const rawHtml = marked.parse(data.content) as string;
  const temp = document.createElement('div');
  temp.innerHTML = rawHtml;

  let html = '';
  let blockIdx = 0;
  for (const child of Array.from(temp.children)) {
    const key = mdKey(blockIdx);
    const hasComment = !!comments[key];

    // Claude comments on this block
    const claudeForBlock = claudeComments.filter(c => c.block === blockIdx);
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
            <span class="comment-text">${escapeHtml(comments[key])}</span>
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

  // Attach click handlers
  container.querySelectorAll<HTMLElement>('.md-block').forEach(el => {
    el.addEventListener('click', () => toggleMdComment(parseInt(el.dataset.block!)));
  });
  container.querySelectorAll<HTMLElement>('[data-edit-md-comment]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      editMdComment(parseInt(el.dataset.editMdComment!));
    });
  });
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

  updateMdStats();
}

export function renderMarkdownComments(): void {
  document.querySelectorAll<HTMLElement>('.md-block').forEach(el => {
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
            <span class="comment-text">${escapeHtml(comments[key])}</span>
            <span class="inline-actions">
              <a>edit</a>
              <a class="del-action" data-delete-md-comment="${idx}">delete</a>
            </span>
          </div>
        </div>
      `;
      div.querySelector<HTMLElement>('[data-edit-md-comment]')!.addEventListener('click', (e) => {
        e.stopPropagation();
        editMdComment(idx);
      });
      el.after(div);
    }
  });
  updateMdStats();
}

export function updateMdStats(): void {
  const count = Object.keys(comments).length;
  document.getElementById('stats')!.innerHTML =
    `${mdMeta.filename || 'Document'}` +
    (count > 0 ? ` &middot; ${count} comment${count !== 1 ? 's' : ''}` : '');
}

export function toggleMdComment(blockIdx: number): void {
  const key = mdKey(blockIdx);
  if (comments[key]) { editMdComment(blockIdx); return; }

  const existing = document.getElementById(mdCommentId(blockIdx));
  if (existing) { existing.querySelector('textarea')?.focus(); return; }

  const block = document.getElementById(mdBlockId(blockIdx));
  if (!block) return;

  const div = document.createElement('div');
  div.className = 'md-comment';
  div.id = mdCommentId(blockIdx);
  div.innerHTML = `
    <div class="comment-box">
      <textarea placeholder="Leave a comment..." autofocus onclick="event.stopPropagation()"></textarea>
      <div class="comment-actions">
        <button class="cancel-btn" data-action="cancel">Cancel</button>
        <button class="save-btn" data-action="save">Save</button>
      </div>
    </div>
  `;

  const textarea = div.querySelector('textarea')!;
  textarea.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { div.remove(); e.preventDefault(); }
    else if (e.key === 'Enter' && e.metaKey) { saveMdComment(blockIdx); e.preventDefault(); }
  });
  textarea.addEventListener('click', (e) => e.stopPropagation());
  div.querySelector('[data-action="cancel"]')!.addEventListener('click', (e) => { e.stopPropagation(); div.remove(); });
  div.querySelector('[data-action="save"]')!.addEventListener('click', (e) => { e.stopPropagation(); saveMdComment(blockIdx); });

  block.after(div);
  textarea.focus();
}

export function editMdComment(blockIdx: number): void {
  const key = mdKey(blockIdx);
  const div = document.getElementById(mdCommentId(blockIdx));
  if (!div) return;

  div.innerHTML = `
    <div class="comment-box">
      <textarea onclick="event.stopPropagation()">${escapeHtml(comments[key])}</textarea>
      <div class="comment-actions">
        <button class="cancel-btn" data-action="cancel-edit">Cancel</button>
        <button class="cancel-btn" data-action="delete" style="color: var(--del-text)">Delete</button>
        <button class="save-btn" data-action="save">Save</button>
      </div>
    </div>
  `;

  const textarea = div.querySelector('textarea')!;
  textarea.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { renderMarkdownComments(); e.preventDefault(); }
    else if (e.key === 'Enter' && e.metaKey) { saveMdComment(blockIdx); e.preventDefault(); }
  });
  textarea.addEventListener('click', (e) => e.stopPropagation());
  div.querySelector('[data-action="cancel-edit"]')!.addEventListener('click', (e) => { e.stopPropagation(); renderMarkdownComments(); });
  div.querySelector('[data-action="delete"]')!.addEventListener('click', (e) => { e.stopPropagation(); delete comments[key]; renderMarkdownComments(); });
  div.querySelector('[data-action="save"]')!.addEventListener('click', (e) => { e.stopPropagation(); saveMdComment(blockIdx); });

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
