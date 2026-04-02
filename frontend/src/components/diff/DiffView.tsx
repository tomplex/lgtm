import { For, Show, createMemo } from 'solid-js';
import { files, activeFileIdx, comments, analysis, wholeFileView, setWholeFileView } from '../../state';
import type { DiffFile, DiffLine as DiffLineType } from '../../state';
import { fetchContext } from '../../api';
import { escapeHtml, detectLang, highlightLine } from '../../utils';
import { computeWordDiff, renderWordDiffHtml } from './WordDiff';
import DiffLine from './DiffLine';
import CommentRow from '../comments/CommentRow';
import WholeFileView from './WholeFileView';

function precomputeWordDiffs(lines: DiffLineType[]): Record<number, string> {
  const result: Record<number, string> = {};
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].type === 'del' && lines[i + 1].type === 'add') {
      const wd = computeWordDiff(lines[i].content, lines[i + 1].content);
      result[i] = renderWordDiffHtml(wd.oldParts, 'wdiff-del');
      result[i + 1] = renderWordDiffHtml(wd.newParts, 'wdiff-add');
    }
  }
  return result;
}

export default function DiffView() {
  const file = createMemo(() => files()[activeFileIdx()]);
  const lang = createMemo(() => (file() ? detectLang(file()!.path) : null));
  const wordDiffs = createMemo(() => (file() ? precomputeWordDiffs(file()!.lines) : {}));

  const fileAnalysis = createMemo(() => {
    const f = file();
    const a = analysis();
    return f && a ? a.files[f.path] : undefined;
  });

  // Collect absolute line numbers visible in the diff
  const orphanedComments = createMemo(() => {
    const f = file();
    if (!f) return [];
    const visibleLines = new Set<number>();
    for (const line of f.lines) {
      if (line.newLine != null) visibleLines.add(line.newLine);
      if (line.oldLine != null) visibleLines.add(line.oldLine);
    }
    return comments.list.filter(
      (c) =>
        c.item === 'diff' &&
        c.file === f.path &&
        c.line != null &&
        !c.parentId &&
        c.status !== 'dismissed' &&
        !visibleLines.has(c.line!),
    );
  });

  return (
    <Show when={file()}>
      {(f) => (
        <Show when={!wholeFileView()} fallback={<WholeFileView />}>
          <div class="diff-file-header">
            {escapeHtml(f().path)}{' '}
            <a
              style="float:right;font-size:11px;font-weight:400;color:var(--accent);cursor:pointer;text-decoration:none"
              onClick={() => setWholeFileView(true)}
            >
              Show whole file
            </a>
            <Show when={fileAnalysis()}>
              {(fa) => <div class="file-header-summary">{escapeHtml(fa().summary)}</div>}
            </Show>
          </div>
          <table class="diff-table">
            <For each={f().lines}>
              {(line, lineIdx) => (
                <Show when={line.type !== 'hunk'} fallback={<HunkRow file={f()} line={line} lineIdx={lineIdx()} />}>
                  <DiffLine
                    line={line}
                    lineIdx={lineIdx()}
                    filePath={f().path}
                    lang={lang()}
                    wordDiffHtml={wordDiffs()[lineIdx()]}
                  />
                </Show>
              )}
            </For>
            <For each={orphanedComments()}>
              {(comment) => (
                <tr class={comment.author === 'claude' ? 'claude-comment-row' : 'comment-row'}>
                  <td colspan="3">
                    <div class="comment-box" style="max-width:calc(100vw - 360px)">
                      <CommentRow comment={{ ...comment, text: `[line ${comment.line}] ${comment.text}` }} />
                    </div>
                  </td>
                </tr>
              )}
            </For>
          </table>
        </Show>
      )}
    </Show>
  );
}

function HunkRow(props: { file: DiffFile; line: DiffLineType; lineIdx: number }) {
  const hunkMatch = () => props.line.content.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
  const hunkNewStart = () => (hunkMatch() ? parseInt(hunkMatch()![2]) : 0);

  const prevNewLine = () => {
    for (let i = props.lineIdx - 1; i >= 0; i--) {
      if (props.file.lines[i].newLine != null) return props.file.lines[i].newLine!;
    }
    return 0;
  };

  const gap = () => hunkNewStart() - prevNewLine() - 1;
  const isSmallGap = () => prevNewLine() > 0 && gap() > 0 && gap() <= 8;

  async function expandContext(lineNum: number, direction: string, rowEl: HTMLElement, count = 20) {
    try {
      const lines = await fetchContext(props.file.path, lineNum, count, direction);
      if (lines.length === 0) {
        rowEl.remove();
        return;
      }
      const fileLang = detectLang(props.file.path);
      let html = '';
      for (const l of lines) {
        const highlighted = fileLang
          ? `<code>${highlightLine(l.content, fileLang)}</code>`
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
        let after: Element = rowEl;
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

  return (
    <>
      <Show when={isSmallGap()}>
        <tr class="expand-row">
          <td colspan="3" style="color:var(--text-muted)">
            &#8943; {gap()} line{gap() !== 1 ? 's' : ''} hidden
          </td>
        </tr>
      </Show>
      <Show when={!isSmallGap() && hunkNewStart() > 1}>
        <tr class="expand-row" onClick={(e) => expandContext(hunkNewStart(), 'up', e.currentTarget as HTMLElement, 20)}>
          <td colspan="3">&#8943; Show more context above</td>
        </tr>
      </Show>
      <tr class="diff-hunk">
        <td class="line-num" />
        <td class="line-num" />
        <td class="line-content">{escapeHtml(props.line.content)}</td>
      </tr>
    </>
  );
}
