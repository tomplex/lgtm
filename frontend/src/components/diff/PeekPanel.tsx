import { createSignal, createResource, Show, For, onMount, onCleanup } from 'solid-js';
import { peekState, setPeekState } from '../../state';
import { fetchSymbol, type SymbolResult } from '../../api';
import { highlightLine, detectLang, escapeHtml } from '../../utils';
import { showToast } from '../shared/Toast';

export default function PeekPanel() {
  const [activeTab, setActiveTab] = createSignal(0);
  let panelRef: HTMLDivElement | undefined;

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

  function handleBodyClick(e: MouseEvent) {
    if (!(e.metaKey || e.ctrlKey)) return;

    const sel = (document as any).caretPositionFromPoint?.(e.clientX, e.clientY)
      ?? (document as any).caretRangeFromPoint?.(e.clientX, e.clientY);
    if (!sel) return;
    const node = 'offsetNode' in sel ? sel.offsetNode : sel.startContainer;
    const offset = 'offset' in sel ? sel.offset : sel.startOffset;
    if (node.nodeType !== Node.TEXT_NODE) return;

    const text = node.textContent ?? '';
    let start = offset;
    let end = offset;
    while (start > 0 && /[\w]/.test(text[start - 1])) start--;
    while (end < text.length && /[\w]/.test(text[end])) end++;
    const word = text.slice(start, end);
    if (word.length < 2 || !/^[a-zA-Z_]/.test(word)) return;

    const current = peekState();
    if (current) {
      setPeekState({ ...current, symbol: word });
    }
  }

  function onDocClick(e: MouseEvent) {
    if (panelRef && !panelRef.contains(e.target as Node)) {
      handleClose();
    }
  }

  function onDocKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleClose();
    }
  }

  onMount(() => {
    setTimeout(() => {
      panelRef?.focus();
      document.addEventListener('click', onDocClick);
    }, 0);
    document.addEventListener('keydown', onDocKeyDown);
  });
  onCleanup(() => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKeyDown);
  });

  return (
    <Show when={peekState() && data()?.results?.length}>
      <tr class="peek-row">
        <td colspan="3">
          <div class="peek-panel" ref={panelRef} onKeyDown={handleKeyDown} tabIndex={-1}>
            <div class="peek-header">
              <button class="peek-close" onClick={handleClose} title="Close (Esc)">✕</button>
              <strong class="peek-symbol">{data()!.symbol}</strong>
              <Show when={activeResult()}>
                {(r) => (
                  <span class="peek-location">{r().file}:{r().line}</span>
                )}
              </Show>
              <Show when={(data()?.results.length ?? 0) > 1}>
                <select
                  class="peek-select"
                  value={activeTab()}
                  onChange={(e) => setActiveTab(parseInt(e.currentTarget.value))}
                >
                  <For each={data()!.results}>
                    {(result, i) => (
                      <option value={i()}>{result.file} :{result.line}</option>
                    )}
                  </For>
                </select>
              </Show>
            </div>
            <Show when={activeResult()}>
              {(r) => (
                <>
                  <Show when={r().docstring}>
                    <div class="peek-docstring">{r().docstring}</div>
                  </Show>
                  <pre class="peek-body" onClick={handleBodyClick}><code innerHTML={highlightBody(r())} /></pre>
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
