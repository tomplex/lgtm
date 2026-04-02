import {
  files,
  activeFileIdx,
  comments,
  analysis,
  setActiveFileIdx,
  setWholeFileView,
  type DiffFile,
} from './state';
import type { Comment } from './comment-types';
import { fetchContext, fetchFile } from './api';
import { renderCommentHtml, handleCommentAction } from './claude-comments';
import { escapeHtml, detectLang, highlightLine, showToast } from './utils';
import { toggleComment } from './comments';
import { renderFileList } from './ui';

export function parseDiff(raw: string): DiffFile[] {
  const result: DiffFile[] = [];
  const lines = raw.split('\n');
  let current: DiffFile | null = null;
  let oldLine = 0,
    newLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('diff --git')) {
      current = { path: '', additions: 0, deletions: 0, lines: [] };
      result.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('--- a/') || line.startsWith('--- /dev/null')) continue;
    if (line.startsWith('+++ b/')) {
      current.path = line.slice(6);
      continue;
    }
    if (line.startsWith('+++ /dev/null')) {
      if (i > 0 && lines[i - 1].startsWith('--- a/')) current.path = lines[i - 1].slice(6) + ' (deleted)';
      continue;
    }
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (match) {
        oldLine = parseInt(match[1]);
        newLine = parseInt(match[2]);
        current.lines.push({ type: 'hunk', content: line, oldLine: null, newLine: null });
      }
      continue;
    }
    if (/^(index |Binary |new file|deleted file|old mode|new mode|similarity|rename|copy )/.test(line)) continue;

    if (line.startsWith('+')) {
      current.additions++;
      current.lines.push({ type: 'add', content: line.slice(1), oldLine: null, newLine: newLine++ });
    } else if (line.startsWith('-')) {
      current.deletions++;
      current.lines.push({ type: 'del', content: line.slice(1), oldLine: oldLine++, newLine: null });
    } else if (line.startsWith(' ') || line === '') {
      current.lines.push({ type: 'context', content: line.slice(1) || '', oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return result.filter((f) => f.path);
}

function computeWordDiff(oldStr: string, newStr: string) {
  const oldWords = oldStr.match(/\S+|\s+/g) || [];
  const newWords = newStr.match(/\S+|\s+/g) || [];

  const m = oldWords.length,
    n = newWords.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldWords[i - 1] === newWords[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  let i = m,
    j = n;
  const oldParts: { text: string; changed: boolean }[] = [];
  const newParts: { text: string; changed: boolean }[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      oldParts.unshift({ text: oldWords[i - 1], changed: false });
      newParts.unshift({ text: newWords[j - 1], changed: false });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      newParts.unshift({ text: newWords[j - 1], changed: true });
      j--;
    } else {
      oldParts.unshift({ text: oldWords[i - 1], changed: true });
      i--;
    }
  }
  return { oldParts, newParts };
}

function renderWordDiff(parts: { text: string; changed: boolean }[], cls: string): string {
  return parts
    .map((p) => (p.changed ? `<span class="${cls}">${escapeHtml(p.text)}</span>` : escapeHtml(p.text)))
    .join('');
}


function precomputeWordDiffs(lines: DiffFile['lines']): Record<number, { text: string; changed: boolean }[]> {
  const wordDiffs: Record<number, { text: string; changed: boolean }[]> = {};
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].type === 'del' && lines[i + 1].type === 'add') {
      const wd = computeWordDiff(lines[i].content, lines[i + 1].content);
      wordDiffs[i] = wd.oldParts;
      wordDiffs[i + 1] = wd.newParts;
    }
  }
  return wordDiffs;
}

function renderDiffLineHtml(
  file: DiffFile,
  line: DiffFile['lines'][number],
  lineIdx: number,
  lang: string | null,
  wordDiffs: Record<number, { text: string; changed: boolean }[]>,
): string {
  let html = '';

  if (line.type === 'hunk') {
    const hunkMatch = line.content.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
    const hunkNewStart = hunkMatch ? parseInt(hunkMatch[2]) : 0;

    let prevNewLine = 0;
    for (let pi = lineIdx - 1; pi >= 0; pi--) {
      if (file.lines[pi].newLine != null) {
        prevNewLine = file.lines[pi].newLine!;
        break;
      }
    }
    const gap = hunkNewStart - prevNewLine - 1;
    const isSmallGap = prevNewLine > 0 && gap > 0 && gap <= 8;

    if (isSmallGap) {
      html += `<tr class="expand-row" data-auto-expand data-file="${escapeHtml(file.path)}" data-line="${prevNewLine}" data-count="${gap}">
        <td colspan="3" style="color:var(--text-muted)">&#8943; ${gap} line${gap !== 1 ? 's' : ''} hidden</td>
      </tr>`;
    } else if (hunkNewStart > 1) {
      html += `<tr class="expand-row" data-expand-up data-file="${escapeHtml(file.path)}" data-line="${hunkNewStart}">
        <td colspan="3">&#8943; Show more context above</td>
      </tr>`;
    }
    html += `<tr class="diff-hunk">
      <td class="line-num"></td><td class="line-num"></td>
      <td class="line-content">${escapeHtml(line.content)}</td>
    </tr>`;
  } else {
    const cls = line.type === 'add' ? 'diff-add' : line.type === 'del' ? 'diff-del' : 'diff-context';
    const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';

    let codeHtml: string;
    if (wordDiffs[lineIdx]) {
      const wdCls = line.type === 'del' ? 'wdiff-del' : 'wdiff-add';
      codeHtml = `<code>${renderWordDiff(wordDiffs[lineIdx], wdCls)}</code>`;
    } else if (lang) {
      codeHtml = `<code>${highlightLine(line.content, lang)}</code>`;
    } else {
      codeHtml = `<span class="diff-text">${escapeHtml(line.content)}</span>`;
    }

    html += `<tr class="${cls}" data-file="${escapeHtml(file.path)}" data-line-idx="${lineIdx}" id="line-${escapeHtml(file.path)}-${lineIdx}">
      <td class="line-num">${line.oldLine ?? ''}</td>
      <td class="line-num">${line.newLine ?? ''}</td>
      <td class="line-content"><span class="diff-prefix">${prefix}</span>${codeHtml}</td>
    </tr>`;
  }

  // Root comments at this location (not replies, not dismissed)
  const lineComments = comments.filter(c =>
    c.item === 'diff' && c.file === file.path && !c.parentId && c.status !== 'dismissed' &&
    c.line === lineIdx
  );
  for (const comment of lineComments) {
    html += `<tr class="${comment.author === 'claude' ? 'claude-comment-row' : 'comment-row'}">
      <td colspan="3">
        <div class="comment-box" style="max-width:calc(100vw - 360px)">
          ${renderCommentHtml(comment)}
        </div>
      </td>
    </tr>`;
  }

  return html;
}

function insertOrphanedComments(file: DiffFile, container: HTMLElement): void {
  const fileComments = comments.filter(c =>
    c.item === 'diff' && c.file === file.path && c.line != null && !c.parentId && c.status !== 'dismissed'
  );
  // Comments whose line index doesn't match any visible diff line index
  const visibleLineIdxs = new Set(file.lines.map((_, idx) => idx));
  const orphaned = fileComments.filter(c => !visibleLineIdxs.has(c.line!));

  orphaned.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  for (const comment of orphaned) {
    const targetLine = comment.line!;

    // Find the closest preceding visible line index
    let anchorLineIdx = -1;
    for (let i = file.lines.length - 1; i >= 0; i--) {
      if (i <= targetLine) {
        anchorLineIdx = i;
        break;
      }
    }

    const labeledComment = { ...comment, text: `[line ${targetLine}] ${comment.text}` };
    const tr = document.createElement('tr');
    tr.className = comment.author === 'claude' ? 'claude-comment-row' : 'comment-row';
    tr.innerHTML = `
      <td colspan="3">
        <div class="comment-box" style="max-width:calc(100vw - 360px)">
          ${renderCommentHtml(labeledComment)}
        </div>
      </td>
    `;

    const table = container.querySelector('.diff-table');
    if (!table) continue;

    if (anchorLineIdx >= 0) {
      let anchor = document.getElementById(`line-${escapeHtml(file.path)}-${anchorLineIdx}`);
      if (anchor) {
        while (
          anchor!.nextElementSibling?.classList.contains('comment-row') ||
          anchor!.nextElementSibling?.classList.contains('claude-comment-row')
        ) {
          anchor = anchor!.nextElementSibling as HTMLElement;
        }
        anchor.after(tr);
        continue;
      }
    }
    const firstRow = table.querySelector('tr');
    if (firstRow) {
      firstRow.before(tr);
    } else {
      table.appendChild(tr);
    }
  }
}

export function renderDiff(fileIdx: number): void {
  const file = files[fileIdx];
  if (!file) return;
  const container = document.getElementById('diff-container')!;
  const lang = detectLang(file.path);

  const fileAnalysis = analysis?.files[file.path];
  const summaryHtml = fileAnalysis
    ? `<div class="file-header-summary">${escapeHtml(fileAnalysis.summary)}</div>`
    : '';
  let html = `<div class="diff-file-header">${escapeHtml(file.path)} <a style="float:right;font-size:11px;font-weight:400;color:var(--accent);cursor:pointer;text-decoration:none" data-action="show-whole-file" data-file-idx="${fileIdx}">Show whole file</a>${summaryHtml}</div>`;
  html += `<table class="diff-table">`;

  const wordDiffs = precomputeWordDiffs(file.lines);

  file.lines.forEach((line, lineIdx) => {
    html += renderDiffLineHtml(file, line, lineIdx, lang, wordDiffs);
  });

  // Expand context at end of file
  const lastLine = file.lines[file.lines.length - 1];
  if (lastLine && lastLine.newLine) {
    html += `<tr class="expand-row" data-expand-down data-file="${escapeHtml(file.path)}" data-line="${lastLine.newLine}">
      <td colspan="3">&#8943; Show more context below</td>
    </tr>`;
  }

  html += `</table>`;
  container.innerHTML = html;

  // Attach event listeners via delegation (remove first to avoid stacking on re-render)
  container.removeEventListener('click', handleDiffContainerClick);
  container.addEventListener('click', handleDiffContainerClick);

  // Auto-expand small gaps
  container.querySelectorAll<HTMLElement>('tr[data-auto-expand]').forEach((row) => {
    const count = parseInt(row.dataset.count!) || 8;
    const next = row.nextElementSibling;
    if (next && next.classList.contains('diff-hunk')) next.remove();
    expandContext(row.dataset.file!, parseInt(row.dataset.line!), 'down', row, count);
  });

  // Render orphaned Claude comments
  insertOrphanedComments(file, container);

  // Handle hash-based navigation
  const hash = window.location.hash;
  if (hash) applyHash(hash);
}

function handleDiffContainerClick(e: Event): void {
  const target = e.target as HTMLElement;

  // Comment actions (all comment types)
  const rerenderDiff = () => { renderDiff(activeFileIdx); renderFileList(); };
  if (handleCommentAction(target, rerenderDiff)) return;

  // Line click -> toggle comment
  const lineRow = target.closest<HTMLElement>('tr[data-file][data-line-idx]');
  if (lineRow && !target.closest('.comment-box') && !target.closest('.claude-comment')) {
    const file = lineRow.dataset.file!;
    const lineIdx = parseInt(lineRow.dataset.lineIdx!);
    toggleComment(file, lineIdx);
    return;
  }

  // Show whole file link
  const wholeFileEl = target.closest<HTMLElement>('[data-action="show-whole-file"]');
  if (wholeFileEl) {
    showWholeFile(parseInt(wholeFileEl.dataset.fileIdx!));
    return;
  }

  // Expand up
  const expandUpEl = target.closest<HTMLElement>('tr[data-expand-up]');
  if (expandUpEl) {
    expandContext(expandUpEl.dataset.file!, parseInt(expandUpEl.dataset.line!), 'up', expandUpEl);
    return;
  }

  // Expand down
  const expandDownEl = target.closest<HTMLElement>('tr[data-expand-down]');
  if (expandDownEl) {
    expandContext(expandDownEl.dataset.file!, parseInt(expandDownEl.dataset.line!), 'down', expandDownEl);
    return;
  }
}


async function expandContext(
  filepath: string,
  lineNum: number,
  direction: string,
  rowEl: Element,
  count = 20,
): Promise<void> {
  try {
    const lines = await fetchContext(filepath, lineNum, count, direction);
    if (lines.length === 0) {
      rowEl.remove();
      return;
    }
    const lang = detectLang(filepath);
    let html = '';
    for (const l of lines) {
      const highlighted = lang
        ? `<code>${highlightLine(l.content, lang)}</code>`
        : `<span class="diff-text">${escapeHtml(l.content)}</span>`;
      html += `<tr class="diff-context">
        <td class="line-num">${l.num}</td>
        <td class="line-num">${l.num}</td>
        <td class="line-content"><span class="diff-prefix"> </span>${highlighted}</td>
      </tr>`;
    }
    const temp = document.createElement('tbody');
    temp.innerHTML = html;
    const rows = Array.from(temp.children);
    if (direction === 'up') {
      for (const row of rows) rowEl.before(row);
    } else {
      let after = rowEl;
      for (const row of rows) {
        after.after(row);
        after = row;
      }
    }
    rowEl.remove();
  } catch {
    /* ignore */
  }
}

export async function showWholeFile(fileIdx: number): Promise<void> {
  const file = files[fileIdx];
  if (!file) return;
  try {
    const lines = await fetchFile(file.path);
    if (lines.length === 0) return;

    const lang = detectLang(file.path);
    const container = document.getElementById('diff-container')!;

    const addLines = new Set<number>();
    file.lines.forEach((l) => {
      if (l.type === 'add' && l.newLine) addLines.add(l.newLine);
    });

    // Build comment index by line number for this file
    const commentsByLine: Record<number, Comment[]> = {};
    for (const c of comments) {
      if (c.item === 'diff' && c.file === file.path && c.line != null && !c.parentId && c.status !== 'dismissed') {
        if (!commentsByLine[c.line]) commentsByLine[c.line] = [];
        commentsByLine[c.line].push(c);
      }
    }

    let html = `<div class="diff-file-header">${escapeHtml(file.path)} <a style="float:right;font-size:11px;font-weight:400;color:var(--accent);cursor:pointer" data-action="back-to-diff" data-file-idx="${fileIdx}">Back to diff</a></div>`;
    html += `<table class="diff-table">`;
    for (const l of lines) {
      const cls = addLines.has(l.num) ? 'diff-add' : '';
      const codeHtml = lang
        ? `<code>${highlightLine(l.content, lang)}</code>`
        : `<span class="diff-text">${escapeHtml(l.content)}</span>`;
      html += `<tr class="${cls}">
        <td class="line-num">${l.num}</td>
        <td class="line-num">${l.num}</td>
        <td class="line-content"><span class="diff-prefix"> </span>${codeHtml}</td>
      </tr>`;

      // Comments on this line
      for (const comment of commentsByLine[l.num] || []) {
        html += `<tr class="${comment.author === 'claude' ? 'claude-comment-row' : 'comment-row'}">
          <td colspan="3">
            <div class="comment-box" style="max-width:calc(100vw - 360px)">
              ${renderCommentHtml(comment)}
            </div>
          </td>
        </tr>`;
      }
    }
    html += `</table>`;
    container.innerHTML = html;

    // Event delegation for dismiss buttons (remove first to avoid stacking on re-render)
    container.removeEventListener('click', handleDiffContainerClick);
    container.addEventListener('click', handleDiffContainerClick);

    // Back-to-diff click handler
    container.querySelector('[data-action="back-to-diff"]')?.addEventListener('click', () => renderDiff(fileIdx));
  } catch (e: any) {
    showToast('Failed to load file: ' + e.message);
  }
}

export function selectFile(idx: number): void {
  setActiveFileIdx(idx);
  setWholeFileView(false);
  document.querySelectorAll('.file-item').forEach((el) => el.classList.remove('active'));
  document.querySelector(`.file-item[data-idx="${idx}"]`)?.classList.add('active');
  if (files[idx]) window.location.hash = 'file=' + encodeURIComponent(files[idx].path);
  renderDiff(idx);
}

export function applyHash(hash: string): void {
  const match = hash.match(/#file=(.+)/);
  if (!match) return;
  const path = decodeURIComponent(match[1]);
  const idx = files.findIndex((f) => f.path === path);
  if (idx >= 0 && idx !== activeFileIdx) selectFile(idx);
}
