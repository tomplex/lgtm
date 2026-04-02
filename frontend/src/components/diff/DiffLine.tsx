import { createSignal, Show, For } from 'solid-js';
import { escapeHtml, highlightLine } from '../../utils';
import { comments, addLocalComment, updateLocalComment } from '../../state';
import { createComment as apiCreateComment } from '../../comment-api';
import type { Comment } from '../../comment-types';
import type { DiffLine as DiffLineType } from '../../state';
import CommentRow from '../comments/CommentRow';
import CommentTextarea from '../comments/CommentTextarea';

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

  const lineComments = () =>
    comments.list.filter(
      (c) =>
        c.item === 'diff' &&
        c.file === props.filePath &&
        c.line === props.lineIdx &&
        !c.parentId &&
        c.status !== 'dismissed',
    );

  function handleLineClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.comment-box') || (e.target as HTMLElement).closest('.claude-comment')) return;
    const existingUserComment = lineComments().find((c) => c.author === 'user' && c.mode === 'review');
    if (existingUserComment) return;
    setShowNewComment(true);
  }

  async function handleSaveNew(text: string) {
    const tempId = `temp-${Date.now()}`;
    const localComment: Comment = {
      id: tempId,
      author: 'user',
      text,
      status: 'active',
      item: 'diff',
      file: props.filePath,
      line: props.lineIdx,
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
        line: props.lineIdx,
        mode: 'review',
      });
      updateLocalComment(tempId, { id: created.id });
    } catch { /* optimistic update already applied */ }
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

      <For each={lineComments()}>
        {(comment) => (
          <tr class={comment.author === 'claude' ? 'claude-comment-row' : 'comment-row'}>
            <td colspan="3">
              <div class="comment-box" style="max-width:calc(100vw - 360px)">
                <CommentRow comment={comment} />
              </div>
            </td>
          </tr>
        )}
      </For>

      <Show when={showNewComment()}>
        <tr class="comment-row">
          <td colspan="3">
            <CommentTextarea
              onSave={handleSaveNew}
              onCancel={() => setShowNewComment(false)}
            />
          </td>
        </tr>
      </Show>
    </>
  );
}
