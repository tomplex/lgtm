import { createSignal, For, Show, createMemo } from 'solid-js';
import { comments, activeItemId, mdMeta, addLocalComment } from '../../state';
import { renderMd } from '../../utils';
import { createComment as apiCreateComment } from '../../comment-api';
import CommentRow from '../comments/CommentRow';
import CommentTextarea from '../comments/CommentTextarea';

export default function DocumentView() {
  const content = createMemo(() => mdMeta().content || '');

  // Parse markdown into blocks (top-level HTML elements)
  const blocks = createMemo(() => {
    const rawHtml = renderMd(content());
    const temp = document.createElement('div');
    temp.innerHTML = rawHtml;
    return Array.from(temp.children).map((child, idx) => ({
      html: child.outerHTML,
      idx,
    }));
  });

  const totalComments = createMemo(
    () => comments.list.filter((c) => c.item === activeItemId() && !c.parentId && c.status !== 'dismissed').length,
  );

  return (
    <div class="md-content">
      <div id="stats">
        {mdMeta().filename || 'Document'}
        <Show when={totalComments() > 0}>
          {' '}
          &middot; {totalComments()} comment{totalComments() !== 1 ? 's' : ''}
        </Show>
      </div>
      <For each={blocks()}>{(block) => <DocumentBlock html={block.html} blockIdx={block.idx} />}</For>
    </div>
  );
}

function DocumentBlock(props: { html: string; blockIdx: number }) {
  const [showNewComment, setShowNewComment] = createSignal(false);

  const blockComments = createMemo(() =>
    comments.list.filter(
      (c) => c.item === activeItemId() && c.block === props.blockIdx && !c.parentId && c.status !== 'dismissed',
    ),
  );

  function handleBlockClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.comment-box') || (e.target as HTMLElement).closest('.reply-textarea-wrap'))
      return;

    // If user already has a comment, don't open a new one
    const existingUser = blockComments().find((c) => c.author === 'user' && c.mode === 'review');
    if (existingUser) return;

    setShowNewComment(true);
  }

  async function handleSave(text: string) {
    const comment = await apiCreateComment({
      author: 'user',
      text,
      item: activeItemId(),
      block: props.blockIdx,
      mode: 'review',
    });
    addLocalComment(comment);
    setShowNewComment(false);
  }

  return (
    <>
      <div
        class="md-block"
        classList={{ 'has-comment': blockComments().length > 0 }}
        id={`md-block-${activeItemId()}-${props.blockIdx}`}
        data-block={props.blockIdx}
        onClick={handleBlockClick}
        innerHTML={props.html}
      />
      <For each={blockComments()}>
        {(comment) => (
          <div class="md-comment" style="margin:4px 0">
            <div class="comment-box" style="max-width:100%">
              <CommentRow comment={comment} />
            </div>
          </div>
        )}
      </For>
      <Show when={showNewComment()}>
        <div class="md-comment">
          <CommentTextarea onSave={handleSave} onCancel={() => setShowNewComment(false)} />
        </div>
      </Show>
    </>
  );
}
