import { createSignal, createEffect, Show, For, onCleanup } from 'solid-js';
import { escapeHtml, highlightLine } from '../../utils';
import {
  comments,
  addLocalComment,
  peekState,
  setPeekState,
  saveOrRetryComment,
  commentTrigger,
  setCommentTrigger,
} from '../../state';
import type { Comment } from '../../comment-types';
import type { DiffLine as DiffLineType } from '../../state';
import CommentRow from '../comments/CommentRow';
import CommentTextarea from '../comments/CommentTextarea';
import PeekPanel from './PeekPanel';

interface Props {
  line: DiffLineType;
  lineIdx: number;
  filePath: string;
  lang: string | null;
  wordDiffHtml?: string;
  /** Pre-highlighted HTML for this line; set when the parent highlighted the
   * whole hunk/file as a block so multi-line tokens render correctly. */
  highlightedHtml?: string;
  /** True when the walkthrough cursor sits on this row. */
  focused?: boolean;
}

export default function DiffLine(props: Props) {
  const [showNewComment, setShowNewComment] = createSignal(false);

  // Open the comment composer when the walkthrough `c` shortcut targets this row.
  createEffect(() => {
    const t = commentTrigger();
    if (!t) return;
    if (t.file === props.filePath && t.lineIdx === props.lineIdx) {
      setShowNewComment(true);
      setCommentTrigger(null);
    }
  });

  const cls = () => {
    const base = props.line.type === 'add' ? 'diff-add' : props.line.type === 'del' ? 'diff-del' : 'diff-context';
    return props.focused ? `${base} wt-line-focus` : base;
  };

  const prefix = () => {
    if (props.line.type === 'add') return '+';
    if (props.line.type === 'del') return '-';
    return ' ';
  };

  const codeHtml = () => {
    if (props.wordDiffHtml) return props.wordDiffHtml;
    if (props.highlightedHtml != null) return `<code>${props.highlightedHtml}</code>`;
    if (props.lang) return `<code>${highlightLine(props.line.content, props.lang)}</code>`;
    return `<span class="diff-text">${escapeHtml(props.line.content)}</span>`;
  };

  // Use the absolute line number (newLine for adds/context, oldLine for deletes)
  const absLine = () => props.line.newLine ?? props.line.oldLine;
  const absSide = (): 'RIGHT' | 'LEFT' => (props.line.newLine != null ? 'RIGHT' : 'LEFT');

  const lineComments = () =>
    comments.list.filter(
      (c) =>
        c.item === 'diff' &&
        c.file === props.filePath &&
        c.line === absLine() &&
        // When a `+` and `-` share the same line number, both rows have absLine()==N.
        // Match on side so the comment lands on the row the user clicked. Comments without
        // a side (Claude/MCP, migrated, replies) default to RIGHT — same default the server
        // applies when submitting to GitHub.
        (c.side ?? 'RIGHT') === absSide() &&
        !c.parentId &&
        c.status !== 'dismissed',
    );

  function getWordAtClick(e: MouseEvent): { word: string; character: number } | null {
    const sel =
      document.caretPositionFromPoint?.(e.clientX, e.clientY) ??
      (document as any).caretRangeFromPoint?.(e.clientX, e.clientY);
    if (!sel) return null;

    const node = 'offsetNode' in sel ? sel.offsetNode : sel.startContainer;
    const offset = 'offset' in sel ? sel.offset : sel.startOffset;
    if (node.nodeType !== Node.TEXT_NODE) return null;

    // Highlight.js wraps each token in its own <span>, so `offset` is local to one token, not
    // the whole line. Compute the line-relative offset by measuring text from the start of the
    // code container (the sibling of .diff-prefix inside .line-content) to the click position.
    const cell = (node.parentElement?.closest('.line-content') as HTMLElement | null) ?? null;
    const codeRoot = cell?.querySelector(':scope > span:not(.diff-prefix)') as HTMLElement | null;
    if (!codeRoot || !codeRoot.contains(node)) return null;

    const range = document.createRange();
    range.setStart(codeRoot, 0);
    range.setEnd(node, offset);
    const lineOffset = range.toString().length;

    const line = props.line.content;
    let start = lineOffset;
    let end = lineOffset;
    while (start > 0 && /[\w]/.test(line[start - 1])) start--;
    while (end < line.length && /[\w]/.test(line[end])) end++;

    const word = line.slice(start, end);
    if (word.length < 2 || !/^[a-zA-Z_]/.test(word)) return null;
    return { word, character: start };
  }

  function handleLineClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.comment-box') || (e.target as HTMLElement).closest('.claude-comment'))
      return;
    if ((e.target as HTMLElement).closest('.peek-panel')) return;

    // Cmd+click: symbol lookup. Only send LSP position info for lines that exist on
    // the HEAD side — deletions can't be resolved against the on-disk worktree.
    if (e.metaKey || e.ctrlKey) {
      const hit = getWordAtClick(e);
      if (hit) {
        const newLine = props.line.newLine;
        setPeekState({
          filePath: props.filePath,
          lineIdx: props.lineIdx,
          symbol: hit.word,
          line: newLine != null ? newLine - 1 : undefined,
          character: newLine != null ? hit.character : undefined,
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

  function handleSaveNew(text: string) {
    submitNew(text, 'review');
  }

  function handleAskClaude(text: string) {
    submitNew(text, 'direct');
  }

  function submitNew(text: string, mode: 'review' | 'direct') {
    const lineNum = absLine();
    const localComment: Comment = {
      id: `temp-${Date.now()}`,
      author: 'user',
      text,
      status: 'active',
      item: 'diff',
      file: props.filePath,
      line: lineNum ?? undefined,
      side: absSide(),
      mode,
    };
    addLocalComment(localComment);
    setShowNewComment(false);
    void saveOrRetryComment(localComment);
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
            const overlay = document.querySelector(
              `#line-${CSS.escape(props.filePath)}-${props.lineIdx} ~ .comment-overlay-row .comment-overlay`,
            );
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
                  <CommentTextarea
                    onSave={handleSaveNew}
                    onAskClaude={handleAskClaude}
                    onCancel={() => setShowNewComment(false)}
                  />
                </div>
              </td>
            </tr>
          );
        })()}
      </Show>
    </>
  );
}
