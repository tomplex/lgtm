import { For, Show, createSignal, onCleanup, onMount, createMemo } from 'solid-js';
import { lspStatus, type Language, type LspStatus } from '../../state';

const LABEL: Record<Language, string> = { python: 'py', typescript: 'ts', rust: 'rs' };

export default function LspStatusBadge() {
  const [now, setNow] = createSignal(Date.now());
  const [indexStart, setIndexStart] = createSignal<Partial<Record<Language, number>>>({});

  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });

  const entries = createMemo(() => {
    const out: Array<{ language: Language; status: LspStatus; elapsedSec?: number }> = [];
    const starts = { ...indexStart() };
    for (const lang of ['python', 'typescript', 'rust'] as const) {
      const s = lspStatus[lang];
      if (s === 'ok') {
        if (starts[lang] != null) { delete starts[lang]; }
        continue;
      }
      if (s === 'indexing') {
        if (starts[lang] == null) starts[lang] = Date.now();
        out.push({ language: lang, status: s, elapsedSec: Math.floor((now() - (starts[lang] ?? now())) / 1000) });
      } else {
        if (starts[lang] != null) { delete starts[lang]; }
        out.push({ language: lang, status: s });
      }
    }
    setIndexStart(starts);
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
