import { createSignal, Show, For, onCleanup } from 'solid-js';
import { escapeHtml, highlightLine } from '../../utils';
import { comments, addLocalComment, updateLocalComment, peekState, setPeekState } from '../../state';
import { createComment as apiCreateComment } from '../../comment-api';
import type { Comment } from '../../comment-types';
import type { DiffLine as DiffLineType } from '../../state';
import CommentRow from '../comments/CommentRow';
import CommentTextarea from '../comments/CommentTextarea';
import PeekPanel from './PeekPanel';

/**
 * Convert a caret offset within a line into a UTF-16 code-unit offset. JS strings are already
 * UTF-16 internally so this is effectively identity, but we name it explicitly so the caller
 * contract with LSP is clear.
 */
export function computeUtf16Offset(line: string, caretOffsetWithinLine: number): number {
  return line.substring(0, caretOffsetWithinLine).length;
}

interface Props {
  line: DiffLineType;
  lineIdx: number;
  filePath: string;
  lang: string | null;
  wordDiffHtml?: string;
}

export default function DiffLine(props: Props) {
  const [showNewComment, setShowNewComment] = createSignal(false);

  const cls = () => {
    if (props.line.type === 'add') return 'diff-add';
    if (props.line.type === 'del') return 'diff-del';
    return 'diff-context';
  };

  const prefix = () => {
    if (props.line.type === 'add') return '+';
    if (props.line.type === 'del') return '-';
    return ' ';
  };

  const codeHtml = () => {
    if (props.wordDiffHtml) return props.wordDiffHtml;
    if (props.lang) return `<code>${highlightLine(props.line.content, props.lang)}</code>`;
    return `<span class="diff-text">${escapeHtml(props.line.content)}</span>`;
  };

  // Use the absolute line number (newLine for adds/context, oldLine for deletes)
  const absLine = () => props.line.newLine ?? props.line.oldLine;
  const absSide = (): 'RIGHT' | 'LEFT' => props.line.newLine != null ? 'RIGHT' : 'LEFT';

  const lineComments = () =>
    comments.list.filter(
      (c) =>
        c.item === 'diff' &&
        c.file === props.filePath &&
        c.line === absLine() &&
        !c.parentId &&
        c.status !== 'dismissed',
    );

  function getWordAtClick(e: MouseEvent): { word: string; character: number } | null {
    const sel = document.caretPositionFromPoint?.(e.clientX, e.clientY)
      ?? (document as any).caretRangeFromPoint?.(e.clientX, e.clientY);
    if (!sel) return null;

    const node = 'offsetNode' in sel ? sel.offsetNode : sel.startContainer;
    const offset = 'offset' in sel ? sel.offset : sel.startOffset;
    if (node.nodeType !== Node.TEXT_NODE) return null;

    const text = node.textContent ?? '';
    let start = offset;
    let end = offset;
    while (start > 0 && /[\w]/.test(text[start - 1])) start--;
    while (end < text.length && /[\w]/.test(text[end])) end++;

    const word = text.slice(start, end);
    if (word.length < 2 || !/^[a-zA-Z_]/.test(word)) return null;
    return { word, character: computeUtf16Offset(props.line.content, start) };
  }

  function handleLineClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.comment-box') || (e.target as HTMLElement).closest('.claude-comment'))
      return;
    if ((e.target as HTMLElement).closest('.peek-panel')) return;

    // Cmd+click: symbol lookup
    if (e.metaKey || e.ctrlKey) {
      const hit = getWordAtClick(e);
      if (hit) {
        setPeekState({
          filePath: props.filePath,
          lineIdx: props.lineIdx,
          symbol: hit.word,
          character: hit.character,
        });
      }
      return;
    }

    const existingUserComment = lineComments().find((c) => c.author === 'user' && c.mode === 'review');
    if (existingUserComment) return;
    setShowNewComment(true);
  }

  const showPeek = () => {
    const p = peekState();
    return p && p.filePath === props.filePath && p.lineIdx === props.lineIdx;
  };

  async function handleSaveNew(text: string) {
    const tempId = `temp-${Date.now()}`;
    const lineNum = absLine();
    const localComment: Comment = {
      id: tempId,
      author: 'user',
      text,
      status: 'active',
      item: 'diff',
      file: props.filePath,
      line: lineNum ?? undefined,
      side: absSide(),
      mode: 'review',
    };
    addLocalComment(localComment);
    setShowNewComment(false);
    try {
      const created = await apiCreateComment({
        author: 'user',
        text,
        item: 'diff',
        file: props.filePath,
        line: lineNum ?? undefined,
        side: absSide(),
        mode: 'review',
      });
      updateLocalComment(tempId, { id: created.id });
    } catch {
      /* optimistic update already applied */
    }
  }

  async function handleAskClaude(text: string) {
    const tempId = `temp-${Date.now()}`;
    const lineNum = absLine();
    const localComment: Comment = {
      id: tempId,
      author: 'user',
      text,
      status: 'active',
      item: 'diff',
      file: props.filePath,
      line: lineNum ?? undefined,
      side: absSide(),
      mode: 'direct',
    };
    addLocalComment(localComment);
    setShowNewComment(false);
    try {
      const created = await apiCreateComment({
        author: 'user',
        text,
        item: 'diff',
        file: props.filePath,
        line: lineNum ?? undefined,
        side: absSide(),
        mode: 'direct',
      });
      updateLocalComment(tempId, { id: created.id });
    } catch {
      /* optimistic update already applied */
    }
  }

  return (
    <>
      <tr
        class={cls()}
        data-file={props.filePath}
        data-line-idx={props.lineIdx}
        id={`line-${props.filePath}-${props.lineIdx}`}
        onClick={handleLineClick}
      >
        <td class="line-num">{props.line.oldLine ?? ''}</td>
        <td class="line-num">{props.line.newLine ?? ''}</td>
        <td class="line-content">
          <span class="diff-prefix">{prefix()}</span>
          <span innerHTML={codeHtml()} />
        </td>
      </tr>

      <Show when={showPeek()}>
        <PeekPanel />
      </Show>

      <For each={lineComments()}>
        {(comment) => (
          <tr class={comment.author === 'claude' ? 'claude-comment-row' : 'comment-row'}>
            <td colspan="3">
              <CommentRow comment={comment} />
            </td>
          </tr>
        )}
      </For>

      <Show when={showNewComment()}>
        {(() => {
          // Click-outside to dismiss empty comment
          const handleClickOutside = (e: MouseEvent) => {
            const overlay = document.querySelector(`#line-${CSS.escape(props.filePath)}-${props.lineIdx} ~ .comment-overlay-row .comment-overlay`);
            if (overlay && !overlay.contains(e.target as Node)) {
              setShowNewComment(false);
            }
          };
          document.addEventListener('mousedown', handleClickOutside);
          onCleanup(() => document.removeEventListener('mousedown', handleClickOutside));
          return (
            <tr class="comment-overlay-row">
              <td colspan="3">
                <div class="comment-overlay">
                  <CommentTextarea onSave={handleSaveNew} onAskClaude={handleAskClaude} onCancel={() => setShowNewComment(false)} />
                </div>
              </td>
            </tr>
          );
        })()}
      </Show>
    </>
  );
}
