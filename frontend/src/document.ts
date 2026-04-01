import { Marked } from 'marked';
import hljs from 'highlight.js';
import {
  comments,
  claudeComments,
  activeItemId,
  mdMeta,
  setMdMeta,
  type MdMeta,
} from './state';
import { escapeHtml } from './utils';
import { saveState } from './persistence';
import { renderClaudeCommentHtml, handleClaudeCommentAction } from './claude-comments';

const marked = new Marked({
  renderer: {
    // marked v12 passes { text, lang } at runtime but types expect positional args
    code(this: unknown, ...args: unknown[]) {
      const token = (typeof args[0] === 'object' ? args[0] : { text: args[0], lang: args[1] }) as {
        text: string;
        lang?: string;
      };
      const highlighted =
        token.lang && hljs.getLanguage(token.lang)
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
  container.querySelectorAll<HTMLElement>('.md-block').forEach((el) => {
    el.addEventListener('click', () => toggleMdComment(parseInt(el.dataset.block!)));
  });
  container.querySelectorAll<HTMLElement>('[data-edit-md-comment]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      editMdComment(parseInt(el.dataset.editMdComment!));
    });
  });

  // Claude comment actions (dismiss, resolve, unresolve, reply, edit-reply, delete-reply)
  const rerenderMd = () => renderMarkdown({ ...mdMeta, content: mdMeta.content || '' });
  container.addEventListener('click', (e) => {
    handleClaudeCommentAction(e.target as HTMLElement, rerenderMd);
  });

  // Delete user comment via inline action
  container.querySelectorAll<HTMLElement>('[data-delete-md-comment]').forEach((el) => {
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
    if (e.key === 'Escape') {
      div.remove();
      e.preventDefault();
    } else if (e.key === 'Enter' && e.metaKey) {
      saveMdComment(blockIdx);
      e.preventDefault();
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
    if (e.key === 'Escape') {
      renderMarkdownComments();
      e.preventDefault();
    } else if (e.key === 'Enter' && e.metaKey) {
      saveMdComment(blockIdx);
      e.preventDefault();
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

