import { onMount } from 'solid-js';

interface Props {
  onSave: (text: string) => void;
  onCancel: () => void;
}

export default function ReplyTextarea(props: Props) {
  let textareaRef!: HTMLTextAreaElement;

  onMount(() => textareaRef.focus());

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
    <div class="reply-textarea-wrap">
      <textarea
        ref={textareaRef}
        class="reply-input"
        style="width:100%;min-height:36px;padding:6px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;resize:vertical;outline:none;font-family:inherit;"
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      />
      <div class="comment-actions" style="margin-top:4px">
        <button class="cancel-btn" onClick={(e) => { e.stopPropagation(); props.onCancel(); }}>
          Cancel
        </button>
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
