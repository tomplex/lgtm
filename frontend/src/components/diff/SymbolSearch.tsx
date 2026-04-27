import { createSignal, createResource, Show, For, onMount } from 'solid-js';
import { symbolSearchOpen, setSymbolSearchOpen } from '../../state';
import { fetchSymbol, type SymbolResult } from '../../api';
import { highlightLine, detectLang, escapeHtml } from '../../utils';

export default function SymbolSearch() {
  let inputRef: HTMLInputElement | undefined;
  let backdropRef: HTMLDivElement | undefined;
  const [query, setQuery] = createSignal('');
  const [debouncedQuery, setDebouncedQuery] = createSignal('');
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [previewResult, setPreviewResult] = createSignal<SymbolResult | null>(null);
  const [previewSymbol, setPreviewSymbol] = createSignal('');
  const [previewTab, setPreviewTab] = createSignal(0);
  const [previewResults, setPreviewResults] = createSignal<SymbolResult[]>([]);
  let debounceTimer: ReturnType<typeof setTimeout>;

  const [data] = createResource(debouncedQuery, async (q) => {
    if (!q || q.length < 2) return null;
    try {
      return await fetchSymbol(q);
    } catch {
      return null;
    }
  });

  function handleInput(value: string) {
    setQuery(value);
    setSelectedIdx(0);
    setPreviewResult(null);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => setDebouncedQuery(value), 200);
  }

  function close() {
    setSymbolSearchOpen(false);
    setQuery('');
    setDebouncedQuery('');
    setPreviewResult(null);
    setPreviewSymbol('');
    setPreviewResults([]);
    setPreviewTab(0);
    setSelectedIdx(0);
  }

  function selectResult(result: SymbolResult, allResults: SymbolResult[], symbol: string) {
    setPreviewResult(result);
    setPreviewSymbol(symbol);
    setPreviewResults(allResults);
    setPreviewTab(allResults.indexOf(result));
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }

    // In preview mode, Backspace with empty input goes back to results
    if (previewResult()) {
      if (e.key === 'Backspace') {
        e.preventDefault();
        setPreviewResult(null);
        setPreviewResults([]);
        setPreviewSymbol('');
        setPreviewTab(0);
        inputRef?.focus();
      }
      return;
    }

    const results = data()?.results;
    if (!results?.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const result = results[selectedIdx()];
      if (result) selectResult(result, results, data()!.symbol);
    }
  }

  function highlightBody(result: SymbolResult): string {
    const lang = detectLang(result.file);
    if (!lang) return escapeHtml(result.body);
    return result.body
      .split('\n')
      .map((line) => highlightLine(line, lang))
      .join('\n');
  }

  function handlePreviewClick(e: MouseEvent) {
    if (!(e.metaKey || e.ctrlKey)) return;

    const sel =
      (document as any).caretPositionFromPoint?.(e.clientX, e.clientY) ??
      (document as any).caretRangeFromPoint?.(e.clientX, e.clientY);
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

    // Navigate to the new symbol
    setPreviewResult(null);
    setQuery(word);
    setDebouncedQuery(word);
    setSelectedIdx(0);
    inputRef?.focus();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === backdropRef) close();
  }

  onMount(() => {
    inputRef?.focus();
  });

  return (
    <Show when={symbolSearchOpen()}>
      <div class="symbol-search-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
        <div class="symbol-search-dialog" onKeyDown={handleKeyDown}>
          <div class="symbol-search-input-row">
            <input
              ref={inputRef}
              type="text"
              class="symbol-search-input"
              placeholder="Search symbol..."
              value={query()}
              onInput={(e) => handleInput(e.currentTarget.value)}
            />
            <Show when={previewResult()}>
              <button
                class="symbol-search-back"
                onClick={() => {
                  setPreviewResult(null);
                  setPreviewResults([]);
                  setPreviewSymbol('');
                  setPreviewTab(0);
                  inputRef?.focus();
                }}
              >
                Back
              </button>
            </Show>
          </div>

          <Show when={!previewResult()}>
            <Show when={data()?.results?.length}>
              <div class="symbol-search-results">
                <For each={data()!.results}>
                  {(result, i) => (
                    <div
                      class={`symbol-search-result ${i() === selectedIdx() ? 'selected' : ''}`}
                      onClick={() => selectResult(result, data()!.results, data()!.symbol)}
                      onMouseEnter={() => setSelectedIdx(i())}
                    >
                      <span class="symbol-search-result-name">{data()!.symbol}</span>
                      <span class="symbol-search-result-kind">{result.kind}</span>
                      <span class="symbol-search-result-location">
                        {result.file}:{result.line}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={debouncedQuery().length >= 2 && data() && data()!.results.length === 0}>
              <div class="symbol-search-empty">No results</div>
            </Show>
          </Show>

          <Show when={previewResult()}>
            {(result) => (
              <div class="symbol-search-preview">
                <div class="peek-header">
                  <strong class="peek-symbol">{previewSymbol()}</strong>
                  <span class="peek-location">
                    {result().file}:{result().line}
                  </span>
                  <Show when={previewResults().length > 1}>
                    <select
                      class="peek-select"
                      value={previewTab()}
                      onChange={(e) => {
                        const idx = parseInt(e.currentTarget.value);
                        setPreviewTab(idx);
                        setPreviewResult(previewResults()[idx]);
                      }}
                    >
                      <For each={previewResults()}>
                        {(r, i) => (
                          <option value={i()}>
                            {r.file}:{r.line}
                          </option>
                        )}
                      </For>
                    </select>
                  </Show>
                </div>
                <Show when={result().docstring}>
                  <div class="peek-docstring">{result().docstring}</div>
                </Show>
                <pre class="peek-body" onClick={handlePreviewClick}>
                  <code innerHTML={highlightBody(result())} />
                </pre>
              </div>
            )}
          </Show>

          <div class="symbol-search-footer">
            <Show
              when={!previewResult()}
              fallback={<>Backspace to go back &middot; Cmd+Click to follow &middot; Esc to close</>}
            >
              &uarr;&darr; navigate &middot; Enter to select &middot; Esc to close
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
