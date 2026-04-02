import { createSignal, For, Show } from 'solid-js';
import { renderMd } from '../../utils';
import { comments, addLocalComment, updateLocalComment, removeLocalComment } from '../../state';
import {
  createComment as apiCreateComment,
  updateComment as apiUpdateComment,
  deleteComment as apiDeleteComment,
} from '../../comment-api';
import type { Comment } from '../../comment-types';
import CommentTextarea from './CommentTextarea';
import ReplyTextarea from './ReplyTextarea';

interface Props {
  comment: Comment;
}

export default function CommentRow(props: Props) {
  const [replying, setReplying] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [editingReplyId, setEditingReplyId] = createSignal<string | null>(null);

  const replies = () => comments.list.filter((c) => c.parentId === props.comment.id);
  const isResolved = () => props.comment.status === 'resolved';
  const isDismissed = () => props.comment.status === 'dismissed';

  async function handleResolve() {
    updateLocalComment(props.comment.id, { status: 'resolved' });
    apiUpdateComment(props.comment.id, { status: 'resolved' });
  }

  async function handleUnresolve() {
    updateLocalComment(props.comment.id, { status: 'active' });
    apiUpdateComment(props.comment.id, { status: 'active' });
  }

  async function handleDismiss() {
    updateLocalComment(props.comment.id, { status: 'dismissed' });
    apiUpdateComment(props.comment.id, { status: 'dismissed' });
  }

  async function handleDelete() {
    removeLocalComment(props.comment.id);
    apiDeleteComment(props.comment.id);
  }

  async function handleEdit(text: string) {
    updateLocalComment(props.comment.id, { text });
    setEditing(false);
    apiUpdateComment(props.comment.id, { text });
  }

  async function handleReply(text: string) {
    const tempId = `temp-${Date.now()}`;
    const localComment: Comment = {
      id: tempId,
      author: 'user',
      text,
      status: 'active',
      parentId: props.comment.id,
      item: props.comment.item,
      file: props.comment.file,
      line: props.comment.line,
      block: props.comment.block,
    };
    addLocalComment(localComment);
    setReplying(false);
    try {
      const created = await apiCreateComment({
        author: 'user',
        text,
        item: props.comment.item,
        parentId: props.comment.id,
        file: props.comment.file,
        line: props.comment.line,
        block: props.comment.block,
      });
      updateLocalComment(tempId, { id: created.id });
    } catch {
      /* optimistic update already applied */
    }
  }

  async function handleEditReply(replyId: string, text: string) {
    updateLocalComment(replyId, { text });
    setEditingReplyId(null);
    apiUpdateComment(replyId, { text });
  }

  async function handleDeleteReply(replyId: string) {
    removeLocalComment(replyId);
    apiDeleteComment(replyId);
  }

  return (
    <div class="claude-comment" classList={{ resolved: isResolved() }} data-comment-id={props.comment.id}>
      <div class="claude-header">
        <span class="claude-label">{props.comment.author === 'claude' ? 'Claude' : 'You'}</span>

        <Show when={isResolved()}>
          <span class="resolve-badge">Resolved</span>
          <span class="inline-actions">
            <a onClick={handleUnresolve}>unresolve</a>
          </span>
        </Show>

        <Show when={isDismissed()}>
          <span class="resolve-badge">Dismissed</span>
        </Show>

        <Show when={!isResolved() && !isDismissed() && props.comment.author === 'claude'}>
          <span class="inline-actions">
            <a onClick={() => setReplying(true)}>reply</a>
            <a onClick={handleResolve}>resolve</a>
            <a onClick={handleDismiss}>dismiss</a>
          </span>
        </Show>

        <Show when={!isResolved() && !isDismissed() && props.comment.author === 'user'}>
          <span class="inline-actions">
            <a onClick={() => setEditing(true)}>edit</a>
            <a class="del-action" onClick={handleDelete}>
              delete
            </a>
          </span>
        </Show>
      </div>

      <Show when={editing()} fallback={<div class="claude-text" innerHTML={renderMd(props.comment.text)} />}>
        <CommentTextarea initialText={props.comment.text} onSave={handleEdit} onCancel={() => setEditing(false)} />
      </Show>

      <For each={replies()}>
        {(reply) => (
          <div class="claude-reply">
            <div class="claude-reply-header">
              <span class="reply-label">{reply.author === 'claude' ? 'Claude' : 'You'}</span>
              <span class="inline-actions">
                <a onClick={() => setEditingReplyId(reply.id)}>edit</a>
                <a class="del-action" onClick={() => handleDeleteReply(reply.id)}>
                  delete
                </a>
              </span>
            </div>
            <Show
              when={editingReplyId() === reply.id}
              fallback={<div class="reply-text" innerHTML={renderMd(reply.text)} />}
            >
              <CommentTextarea
                initialText={reply.text}
                onSave={(text) => handleEditReply(reply.id, text)}
                onCancel={() => setEditingReplyId(null)}
              />
            </Show>
          </div>
        )}
      </For>

      <Show when={replying()}>
        <ReplyTextarea onSave={handleReply} onCancel={() => setReplying(false)} />
      </Show>
    </div>
  );
}
