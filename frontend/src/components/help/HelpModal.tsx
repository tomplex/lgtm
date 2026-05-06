import { For, Show } from 'solid-js';
import { helpModalOpen, setHelpModalOpen } from '../../state';
import { SHORTCUT_SECTIONS } from './shortcuts';

export default function HelpModal() {
  let backdropRef: HTMLDivElement | undefined;

  function close() {
    setHelpModalOpen(false);
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === backdropRef) close();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' || e.key === '?') {
      e.preventDefault();
      close();
    }
  }

  return (
    <Show when={helpModalOpen()}>
      <div
        class="help-modal-backdrop"
        ref={(el) => {
          backdropRef = el;
          // Focus the backdrop so Esc/? close the modal even when nothing else is focused.
          queueMicrotask(() => el?.focus());
        }}
        onClick={onBackdropClick}
        onKeyDown={onKeyDown}
        tabIndex={-1}
      >
        <div class="help-modal-dialog">
          <div class="help-modal-header">
            <h2>Keyboard shortcuts</h2>
            <button class="help-modal-close" aria-label="Close" onClick={close}>
              ×
            </button>
          </div>
          <div class="help-modal-body">
            <For each={SHORTCUT_SECTIONS}>
              {(section) => (
                <section class="help-modal-section">
                  <h3>{section.title}</h3>
                  <dl class="help-modal-list">
                    <For each={section.shortcuts}>
                      {(s) => (
                        <>
                          <dt>
                            <For each={s.keys}>{(key) => <kbd>{key}</kbd>}</For>
                          </dt>
                          <dd>{s.desc}</dd>
                        </>
                      )}
                    </For>
                  </dl>
                </section>
              )}
            </For>
          </div>
          <div class="help-modal-footer">
            <kbd>?</kbd> or <kbd>Esc</kbd> to close
          </div>
        </div>
      </div>
    </Show>
  );
}
