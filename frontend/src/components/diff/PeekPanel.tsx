import { createSignal, createResource, Show, For } from 'solid-js';
import { peekState, setPeekState } from '../../state';
import { fetchSymbol, type SymbolResult } from '../../api';
import { highlightLine, detectLang, escapeHtml } from '../../utils';
import { showToast } from '../shared/Toast';

export default function PeekPanel() {
  const [activeTab, setActiveTab] = createSignal(0);

  const [data] = createResource(
    () => peekState()?.symbol,
    async (symbol) => {
      if (!symbol) return null;
      try {
        const resp = await fetchSymbol(symbol);
        if (resp.results.length === 0) {
          showToast('No definition found');
          setPeekState(null);
          return null;
        }
        setActiveTab(0);
        return resp;
      } catch {
        showToast('Symbol lookup failed');
        setPeekState(null);
        return null;
      }
    },
  );

  function activeResult(): SymbolResult | undefined {
    return data()?.results[activeTab()];
  }

  function highlightBody(result: SymbolResult): string {
    const lang = detectLang(result.file);
    if (!lang) return escapeHtml(result.body);
    return result.body
      .split('\n')
      .map((line) => highlightLine(line, lang))
      .join('\n');
  }

  function handleClose() {
    setPeekState(null);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleClose();
    }
  }

  return (
    <Show when={peekState() && data()?.results?.length}>
      <tr class="peek-row">
        <td colspan="3">
          <div
            class="peek-panel"
            onKeyDown={handleKeyDown}
            tabIndex={-1}
            ref={(el) => setTimeout(() => el.focus(), 0)}
          >
            <div class="peek-header">
              <button class="peek-close" onClick={handleClose} title="Close (Esc)">✕</button>
              <strong class="peek-symbol">{data()!.symbol}</strong>
              <Show when={activeResult()}>
                {(r) => (
                  <span class="peek-location">{r().file}:{r().line}</span>
                )}
              </Show>
              <Show when={(data()?.results.length ?? 0) > 1}>
                <span class="peek-tabs">
                  <For each={data()!.results}>
                    {(result, i) => (
                      <button
                        class="peek-tab"
                        classList={{ active: activeTab() === i() }}
                        onClick={() => setActiveTab(i())}
                      >
                        {result.file.split('/').pop()}
                      </button>
                    )}
                  </For>
                </span>
              </Show>
            </div>
            <Show when={activeResult()}>
              {(r) => (
                <>
                  <Show when={r().docstring}>
                    <div class="peek-docstring">{r().docstring}</div>
                  </Show>
                  <pre class="peek-body"><code innerHTML={highlightBody(r())} /></pre>
                </>
              )}
            </Show>
            <div class="peek-footer">Esc to close</div>
          </div>
        </td>
      </tr>
    </Show>
  );
}
