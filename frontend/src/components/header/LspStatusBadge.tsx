import { For, Show, createSignal, onCleanup, onMount, createEffect, createMemo, untrack } from 'solid-js';
import { lspStatus, type Language, type LspStatus } from '../../state';

const LABEL: Record<Language, string> = { python: 'py', typescript: 'ts', rust: 'rs' };

export default function LspStatusBadge() {
  const [now, setNow] = createSignal(Date.now());
  // Per-language timestamp of when `indexing` was first observed. Updated by an effect
  // that only tracks lspStatus, so writes here never feed back into the memo below.
  const [starts, setStarts] = createSignal<Partial<Record<Language, number>>>({});

  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });

  createEffect(() => {
    // Track each language's status (triggers the effect on any change).
    const current = {
      python: lspStatus.python,
      typescript: lspStatus.typescript,
      rust: lspStatus.rust,
    };
    untrack(() => {
      const next = { ...starts() };
      let changed = false;
      for (const lang of ['python', 'typescript', 'rust'] as const) {
        const s = current[lang];
        if (s === 'indexing' && next[lang] == null) {
          next[lang] = Date.now();
          changed = true;
        } else if (s !== 'indexing' && next[lang] != null) {
          delete next[lang];
          changed = true;
        }
      }
      if (changed) setStarts(next);
    });
  });

  const entries = createMemo(() => {
    const s = starts();
    const out: Array<{ language: Language; status: LspStatus; elapsedSec?: number }> = [];
    for (const lang of ['python', 'typescript', 'rust'] as const) {
      const status = lspStatus[lang];
      if (status === 'ok') continue;
      if (status === 'indexing') {
        out.push({ language: lang, status, elapsedSec: Math.floor((now() - (s[lang] ?? now())) / 1000) });
      } else {
        out.push({ language: lang, status });
      }
    }
    return out;
  });

  return (
    <Show when={entries().length > 0}>
      <span class="lsp-status-badge">
        <For each={entries()}>
          {(e) => (
            <span class={`lsp-chip lsp-chip-${e.status}`} title={`${e.language} LSP: ${e.status}`}>
              {LABEL[e.language]}: {e.status}{e.elapsedSec != null ? ` ${e.elapsedSec}s` : ''}
            </span>
          )}
        </For>
      </span>
    </Show>
  );
}
