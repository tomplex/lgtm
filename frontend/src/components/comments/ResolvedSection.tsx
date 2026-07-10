import { createSignal, For, Show } from 'solid-js';
import type { Comment } from '../../comment-types';
import CommentRow from './CommentRow';

// GitHub-style collapsible for resolved review comments. Hidden by default;
// expands to show each resolved comment (with its resolution note, rendered by
// CommentRow).
export default function ResolvedSection(props: { comments: Comment[] }) {
  const [open, setOpen] = createSignal(false);

  return (
    <div class="resolved-section">
      <button type="button" class="resolved-toggle" aria-expanded={open()} onClick={() => setOpen(!open())}>
        <span class="resolved-caret">{open() ? '▾' : '▸'}</span>
        Resolved ({props.comments.length})
      </button>
      <Show when={open()}>
        <div class="resolved-body">
          <For each={props.comments}>{(comment) => <CommentRow comment={comment} />}</For>
        </div>
      </Show>
    </div>
  );
}
