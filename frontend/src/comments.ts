import { comments, files, activeFileIdx, activeItemId, sessionItems, addLocalComment, updateLocalComment, removeLocalComment } from './state';
import { escapeHtml } from './utils';
import { renderDiff } from './diff';
import { renderFileList } from './ui';
import { createComment as apiCreateComment, updateComment as apiUpdateComment, deleteComment as apiDeleteComment } from './comment-api';
import type { Comment } from './comment-types';

export function toggleComment(file: string, lineIdx: number): void {
  // Check if there's already a user review comment at this location
  const existing = comments.find(
    c => c.author === 'user' && c.file === file && c.line === lineIdx && !c.parentId && c.item === 'diff',
  );
  if (existing) {
    editComment(existing);
    return;
  }

  // Check if a textarea is already open for this location
  const rowId = `cr-${file}-${lineIdx}`;
  const existingRow = document.getElementById(rowId);
  if (existingRow) {
    existingRow.querySelector('textarea')?.focus();
    return;
  }

  const lineRow = document.querySelector(`tr[data-file="${CSS.escape(file)}"][data-line-idx="${lineIdx}"]`);
  if (!lineRow) return;

  const commentRow = document.createElement('tr');
  commentRow.className = 'comment-row';
  commentRow.id = rowId;
  commentRow.innerHTML = `
    <td colspan="3">
      <div class="comment-box">
        <textarea placeholder="Leave a comment..." autofocus></textarea>
        <div class="comment-actions">
          <button class="cancel-btn" data-action="cancel">Cancel</button>
          <button class="save-btn" data-action="save">Save</button>
        </div>
      </div>
    </td>
  `;

  const textarea = commentRow.querySelector('textarea')!;
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      commentRow.remove();
      e.preventDefault();
    } else if (e.key === 'Enter' && e.metaKey) {
      saveNewComment(file, lineIdx, textarea);
      e.preventDefault();
    }
  });
  commentRow.querySelector('[data-action="cancel"]')!.addEventListener('click', () => commentRow.remove());
  commentRow.querySelector('[data-action="save"]')!.addEventListener('click', () => saveNewComment(file, lineIdx, textarea));

  lineRow.after(commentRow);
  textarea.focus();
}

async function saveNewComment(file: string, lineIdx: number, textarea: HTMLTextAreaElement): Promise<void> {
  const text = textarea.value.trim();
  if (!text) {
    textarea.closest('tr')?.remove();
    return;
  }
  const tempId = `temp-${Date.now()}`;
  const localComment: Comment = {
    id: tempId,
    author: 'user',
    text,
    status: 'active',
    item: 'diff',
    file,
    line: lineIdx,
    mode: 'review',
  };
  addLocalComment(localComment);
  renderDiff(activeFileIdx);
  renderFileList();
  try {
    const created = await apiCreateComment({
      author: 'user',
      text,
      item: 'diff',
      file,
      line: lineIdx,
      mode: 'review',
    });
    updateLocalComment(tempId, { id: created.id });
  } catch { /* optimistic update already applied */ }
}

function editComment(comment: Comment): void {
  // Find the rendered comment element or the row for this comment
  const rowId = `cr-${comment.file}-${comment.line}`;
  let row = document.getElementById(rowId);
  if (!row) return;

  const td = row.querySelector('td')!;
  td.innerHTML = `
    <div class="comment-box">
      <textarea>${escapeHtml(comment.text)}</textarea>
      <div class="comment-actions">
        <button class="cancel-btn" data-action="cancel-edit">Cancel</button>
        <button class="cancel-btn" data-action="delete" style="color: var(--del-text)">Delete</button>
        <button class="save-btn" data-action="save">Save</button>
      </div>
    </div>
  `;

  const textarea = td.querySelector('textarea')!;
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      renderDiff(activeFileIdx);
      e.preventDefault();
    } else if (e.key === 'Enter' && e.metaKey) {
      saveEditedComment(comment, textarea);
      e.preventDefault();
    }
  });
  td.querySelector('[data-action="cancel-edit"]')!.addEventListener('click', () => renderDiff(activeFileIdx));
  td.querySelector('[data-action="delete"]')!.addEventListener('click', () => deleteUserComment(comment));
  td.querySelector('[data-action="save"]')!.addEventListener('click', () => saveEditedComment(comment, textarea));

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

async function saveEditedComment(comment: Comment, textarea: HTMLTextAreaElement): Promise<void> {
  const text = textarea.value.trim();
  if (!text) {
    deleteUserComment(comment);
    return;
  }
  updateLocalComment(comment.id, { text });
  renderDiff(activeFileIdx);
  renderFileList();
  try {
    await apiUpdateComment(comment.id, { text });
  } catch { /* optimistic update already applied */ }
}

async function deleteUserComment(comment: Comment): Promise<void> {
  removeLocalComment(comment.id);
  renderDiff(activeFileIdx);
  renderFileList();
  try {
    await apiDeleteComment(comment.id);
  } catch { /* optimistic update already applied */ }
}

export function jumpToComment(direction: 'next' | 'prev'): void {
  const container = document.getElementById('diff-container')!;
  const rows = Array.from(container.querySelectorAll('tr.comment-row, tr.claude-comment-row'));
  if (rows.length === 0) return;

  const containerRect = container.getBoundingClientRect();

  if (direction === 'next') {
    const next = rows.find((r) => r.getBoundingClientRect().top > containerRect.top + 10);
    if (next) next.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else rows[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else {
    const prev = rows.reverse().find((r) => r.getBoundingClientRect().top < containerRect.top - 10);
    if (prev) prev.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else rows[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function formatDiffComments(): string {
  const byFile: Record<string, { lineNum: number | string; lineType: string; lineContent: string; comment: string }[]> = {};

  const diffUserComments = comments.filter(
    c => c.author === 'user' && c.item === 'diff' && c.file && c.line != null && !c.parentId && c.mode === 'review',
  );

  for (const c of diffUserComments) {
    const filePath = c.file!;
    if (!byFile[filePath]) byFile[filePath] = [];
    const file = files.find((f) => f.path === filePath);
    const line = file?.lines[c.line!];
    byFile[filePath].push({
      lineNum: line?.newLine ?? line?.oldLine ?? '?',
      lineType: line?.type ?? 'context',
      lineContent: line?.content ?? '',
      comment: c.text,
    });
  }

  let output = '';
  for (const [filePath, fileComments] of Object.entries(byFile)) {
    output += `## ${filePath}\n\n`;
    for (const fc of fileComments.sort((a, b) => Number(a.lineNum) - Number(b.lineNum))) {
      const prefix = fc.lineType === 'add' ? '+' : fc.lineType === 'del' ? '-' : ' ';
      output += `Line ${fc.lineNum}: \`${prefix}${fc.lineContent.trim()}\`\n`;
      output += `> ${fc.comment}\n\n`;
    }
  }
  return output;
}

function formatClaudeInteractions(): string {
  const byFile: Record<string, { lineNum: number | string; comment: string; reply?: string; resolved: boolean }[]> = {};

  const claudeDiffComments = comments.filter(
    c => c.author === 'claude' && c.item === 'diff' && c.file != null && !c.parentId,
  );

  for (const cc of claudeDiffComments) {
    const replies = comments.filter(r => r.parentId === cc.id);
    const reply = replies.find(r => r.author === 'user');
    const resolved = cc.status === 'resolved';

    if (!reply && !resolved) continue;

    const filePath = cc.file!;
    if (!byFile[filePath]) byFile[filePath] = [];
    byFile[filePath].push({
      lineNum: cc.line ?? '?',
      comment: cc.text,
      reply: reply?.text,
      resolved,
    });
  }

  let output = '';
  for (const [filePath, interactions] of Object.entries(byFile)) {
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

function formatDocComments(): string {
  let output = '';
  for (const item of sessionItems) {
    if (item.id === 'diff') continue;

    // User comments on this document
    const docUserComments = comments.filter(
      c => c.author === 'user' && c.item === item.id && c.block != null && !c.parentId,
    );

    if (docUserComments.length === 0) continue;
    output += `## ${item.title}\n\n`;

    const sorted = docUserComments.sort((a, b) => (a.block ?? 0) - (b.block ?? 0));
    for (const c of sorted) {
      const blockEl = document.getElementById(`md-block-${item.id}-${c.block}`);
      const preview = blockEl?.textContent?.trim()?.slice(0, 80) || `Block ${c.block}`;
      output += `**${preview}${preview.length >= 80 ? '...' : ''}**\n`;
      output += `> ${c.text}\n\n`;
    }
  }
  return output;
}

function formatDocClaudeInteractions(): string {
  let output = '';
  for (const item of sessionItems) {
    if (item.id === 'diff') continue;
    const itemClaudeComments = comments.filter(
      c => c.author === 'claude' && c.item === item.id && !c.parentId,
    );
    const interactions: { block: number; comment: string; reply?: string; resolved: boolean }[] = [];

    for (const cc of itemClaudeComments) {
      const replies = comments.filter(r => r.parentId === cc.id);
      const reply = replies.find(r => r.author === 'user');
      const resolved = cc.status === 'resolved';
      if (!reply && !resolved) continue;
      interactions.push({ block: cc.block ?? 0, comment: cc.text, reply: reply?.text, resolved });
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

export function formatAllComments(): string {
  let output = '';

  const diffOutput = formatDiffComments();
  if (diffOutput) output += diffOutput;

  const claudeDiffOutput = formatClaudeInteractions();
  if (claudeDiffOutput) output += claudeDiffOutput;

  const docOutput = formatDocComments();
  if (docOutput) output += docOutput;

  const claudeDocOutput = formatDocClaudeInteractions();
  if (claudeDocOutput) output += claudeDocOutput;

  return output || 'No comments (LGTM).';
}
