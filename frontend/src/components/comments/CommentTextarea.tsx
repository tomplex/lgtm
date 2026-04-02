import { onMount } from 'solid-js';

interface Props {
  initialText?: string;
  placeholder?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  showDelete?: boolean;
  onDelete?: () => void;
  onAskClaude?: (text: string) => void;
}

export default function CommentTextarea(props: Props) {
  let textareaRef!: HTMLTextAreaElement;

  onMount(() => {
    textareaRef.focus();
    if (props.initialText) {
      textareaRef.setSelectionRange(textareaRef.value.length, textareaRef.value.length);
    }
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      props.onCancel();
    } else if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      const text = textareaRef.value.trim();
      if (text) props.onSave(text);
      else props.onCancel();
    }
  }

  return (
    <div class="comment-box">
      <textarea
        ref={textareaRef}
        placeholder={props.placeholder ?? 'Leave a comment...'}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        {props.initialText ?? ''}
      </textarea>
      <div class="comment-actions">
        <button
          class="cancel-btn"
          onClick={(e) => {
            e.stopPropagation();
            props.onCancel();
          }}
        >
          Cancel
        </button>
        {props.showDelete && (
          <button
            class="cancel-btn"
            style="color: var(--del-text)"
            onClick={(e) => {
              e.stopPropagation();
              props.onDelete?.();
            }}
          >
            Delete
          </button>
        )}
        {props.onAskClaude && (
          <button
            class="ask-claude-save-btn"
            onClick={(e) => {
              e.stopPropagation();
              const text = textareaRef.value.trim();
              if (text) props.onAskClaude!(text);
              else props.onCancel();
            }}
          >
            Ask Claude
          </button>
        )}
        <button
          class="save-btn"
          onClick={(e) => {
            e.stopPropagation();
            const text = textareaRef.value.trim();
            if (text) props.onSave(text);
            else props.onCancel();
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
