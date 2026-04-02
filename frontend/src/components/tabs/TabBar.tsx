import { For, Show, createSignal } from 'solid-js';
import { sessionItems, activeItemId, comments } from '../../state';
import type { Comment } from '../../comment-types';
import FilePicker from './FilePicker';

interface Props {
  onSwitchItem: (itemId: string) => void;
  onCloseTab: (itemId: string) => void;
}

export default function TabBar(props: Props) {
  const [showPicker, setShowPicker] = createSignal(false);

  function badgeCounts(itemId: string) {
    const itemComments = comments.list.filter((c: Comment) => c.item === itemId);
    const claude = itemComments.filter((c) => c.author === 'claude' && !c.parentId).length;
    const user = itemComments.filter((c) => c.author === 'user' && !c.parentId).length;
    return { claude, user };
  }

  return (
    <div class="tab-bar" id="tab-bar">
      <For each={sessionItems()}>
        {(item) => {
          const counts = () => badgeCounts(item.id);
          return (
            <div
              class="tab-item"
              classList={{ active: activeItemId() === item.id }}
              onClick={() => props.onSwitchItem(item.id)}
            >
              <span class="tab-title">{item.title}</span>
              <Show when={counts().claude > 0}>
                <span class="tab-badge claude">{counts().claude}</span>
              </Show>
              <Show when={counts().user > 0}>
                <span class="tab-badge user">{counts().user}</span>
              </Show>
              <Show when={item.id !== 'diff'}>
                <span
                  class="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onCloseTab(item.id);
                  }}
                >
                  &times;
                </span>
              </Show>
            </div>
          );
        }}
      </For>
      <div
        class="tab-item tab-add"
        onClick={(e) => {
          e.stopPropagation();
          setShowPicker(!showPicker());
        }}
      >
        +
      </div>
      <Show when={showPicker()}>
        <FilePicker onClose={() => setShowPicker(false)} onSelect={() => setShowPicker(false)} />
      </Show>
    </div>
  );
}
