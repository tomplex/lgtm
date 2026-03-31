import {
  comments, files, activeFileIdx, claudeComments, resolvedComments,
  sessionItems,
  lineIdToKey,
} from './state';
import { escapeHtml } from './utils';
import { renderDiff } from './diff';
import { renderFileList } from './ui';
import { saveState } from './persistence';

export function toggleComment(lineId: string): void {
  const lineKey = lineIdToKey(lineId);
  if (!lineKey) return;
  if (comments[lineKey]) { editComment(lineId); return; }
  const existing = document.getElementById('cr-' + lineId);
  if (existing) { existing.querySelector('textarea')?.focus(); return; }

  const lineRow = document.getElementById('line-' + lineId);
  if (!lineRow) return;

  const commentRow = document.createElement('tr');
  commentRow.className = 'comment-row';
  commentRow.id = 'cr-' + lineId;
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
    if (e.key === 'Escape') { cancelComment(lineId); e.preventDefault(); }
    else if (e.key === 'Enter' && e.metaKey) { saveComment(lineId); e.preventDefault(); }
  });
  commentRow.querySelector('[data-action="cancel"]')!.addEventListener('click', () => cancelComment(lineId));
  commentRow.querySelector('[data-action="save"]')!.addEventListener('click', () => saveComment(lineId));

  lineRow.after(commentRow);
  textarea.focus();
}

export function editComment(lineId: string): void {
  const row = document.getElementById('cr-' + lineId);
  if (!row) return;
  const lineKey = lineIdToKey(lineId);
  if (!lineKey) return;

  const currentText = comments[lineKey];
  const td = row.querySelector('td')!;
  td.innerHTML = `
    <div class="comment-box">
      <textarea>${escapeHtml(currentText)}</textarea>
      <div class="comment-actions">
        <button class="cancel-btn" data-action="cancel-edit">Cancel</button>
        <button class="cancel-btn" data-action="delete" style="color: var(--del-text)">Delete</button>
        <button class="save-btn" data-action="save">Save</button>
      </div>
    </div>
  `;

  const textarea = td.querySelector('textarea')!;
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { renderDiff(activeFileIdx); e.preventDefault(); }
    else if (e.key === 'Enter' && e.metaKey) { saveComment(lineId); e.preventDefault(); }
  });
  td.querySelector('[data-action="cancel-edit"]')!.addEventListener('click', () => renderDiff(activeFileIdx));
  td.querySelector('[data-action="delete"]')!.addEventListener('click', () => deleteComment(lineId));
  td.querySelector('[data-action="save"]')!.addEventListener('click', () => saveComment(lineId));

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function saveComment(lineId: string): void {
  const row = document.getElementById('cr-' + lineId);
  if (!row) return;
  const lineKey = lineIdToKey(lineId);
  if (!lineKey) return;
  const text = row.querySelector('textarea')?.value?.trim();
  if (!text) { deleteComment(lineId); return; }
  comments[lineKey] = text;
  saveState();
  renderDiff(activeFileIdx);
  renderFileList();
}

function cancelComment(lineId: string): void {
  const lineKey = lineIdToKey(lineId);
  if (lineKey && !comments[lineKey]) document.getElementById('cr-' + lineId)?.remove();
}

function deleteComment(lineId: string): void {
  const lineKey = lineIdToKey(lineId);
  if (lineKey) delete comments[lineKey];
  saveState();
  renderDiff(activeFileIdx);
  renderFileList();
}

export function jumpToComment(direction: 'next' | 'prev'): void {
  const container = document.getElementById('diff-container')!;
  const rows = Array.from(container.querySelectorAll('tr.comment-row, tr.claude-comment-row'));
  if (rows.length === 0) return;

  const containerRect = container.getBoundingClientRect();

  if (direction === 'next') {
    const next = rows.find(r => r.getBoundingClientRect().top > containerRect.top + 10);
    if (next) next.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else rows[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else {
    const prev = rows.reverse().find(r => r.getBoundingClientRect().top < containerRect.top - 10);
    if (prev) prev.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else rows[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function formatDiffComments(): string {
  const byFile: Record<string, { lineNum: number | string; lineType: string; lineContent: string; comment: string }[]> = {};
  for (const [key, text] of Object.entries(comments)) {
    if (key.startsWith('doc:') || key.startsWith('md::') || key.startsWith('claude:')) continue;
    const sepIdx = key.lastIndexOf('::');
    const filePath = key.substring(0, sepIdx);
    const lineIdxStr = key.substring(sepIdx + 2);
    if (!byFile[filePath]) byFile[filePath] = [];
    const lineIdx = parseInt(lineIdxStr);
    const file = files.find(f => f.path === filePath);
    const line = file?.lines[lineIdx];
    byFile[filePath].push({
      lineNum: line?.newLine ?? line?.oldLine ?? '?',
      lineType: line?.type ?? 'context',
      lineContent: line?.content ?? '',
      comment: text,
    });
  }
  let output = '';
  for (const [filePath, fileComments] of Object.entries(byFile)) {
    output += `## ${filePath}\n\n`;
    for (const c of fileComments.sort((a, b) => Number(a.lineNum) - Number(b.lineNum))) {
      const prefix = c.lineType === 'add' ? '+' : c.lineType === 'del' ? '-' : ' ';
      output += `Line ${c.lineNum}: \`${prefix}${c.lineContent.trim()}\`\n`;
      output += `> ${c.comment}\n\n`;
    }
  }
  return output;
}

function formatClaudeInteractions(): string {
  const byFile: Record<string, { lineNum: number | string; comment: string; reply?: string; resolved: boolean }[]> = {};

  for (const cc of claudeComments) {
    if (cc.file == null || cc._item !== 'diff') continue;
    const ccKey = `claude:${cc._item}:${cc._serverIndex}`;
    const reply = comments[ccKey];
    const resolved = resolvedComments.has(ccKey);

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

export function formatAllComments(): string {
  let output = '';

  const diffOutput = formatDiffComments();
  if (diffOutput) output += diffOutput;

  const claudeDiffOutput = formatClaudeInteractions();
  if (claudeDiffOutput) output += claudeDiffOutput;

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

  const claudeDocOutput = formatDocClaudeInteractions();
  if (claudeDocOutput) output += claudeDocOutput;

  return output || 'No comments (LGTM).';
}
