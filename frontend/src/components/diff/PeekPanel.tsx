import { createSignal, createResource, Show, For, onMount, onCleanup } from 'solid-js';
import { peekState, setPeekState, setLspStatus } from '../../state';
import {
  fetchSymbol,
  fetchDefinition,
  fetchHover,
  fetchReferences,
  cancelLspRequest,
  type SymbolResult,
} from '../../api';
import { highlightLine, detectLang, escapeHtml, renderMd } from '../../utils';
import { showToast } from '../shared/Toast';
import type { Language } from '../../state';

function languageFromFile(file: string): Language | null {
  const lower = file.toLowerCase();
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.jsx'))
    return 'typescript';
  if (lower.endsWith('.rs')) return 'rust';
  return null;
}

export default function PeekPanel() {
  const [activeTab, setActiveTab] = createSignal(0);
  const [showAllRefs, setShowAllRefs] = createSignal(false);
  let panelRef: HTMLDivElement | undefined;

  // A LSP-resolvable peek has both `line` (0-based file line) and `character` (UTF-16 offset).
  const hasLspPos = (
    s: ReturnType<typeof peekState>,
  ): s is NonNullable<ReturnType<typeof peekState>> & { line: number; character: number } =>
    s != null && s.line != null && s.character != null;

  // Definition — LSP when position is present, else name-search fallback
  const [data] = createResource(
    () => peekState(),
    async (state) => {
      if (!state) return null;
      try {
        if (hasLspPos(state)) {
          const resp = await fetchDefinition(state.filePath, state.line, state.character);
          const lang = languageFromFile(state.filePath);
          if (lang) {
            const status =
              resp.status === 'ok'
                ? 'ok'
                : resp.status === 'indexing'
                  ? 'indexing'
                  : resp.status === 'fallback'
                    ? 'ok'
                    : 'missing';
            setLspStatus(lang, status);
          }
          if (resp.result.results.length === 0) {
            showToast('No definition found');
            setPeekState(null);
            return null;
          }
          setActiveTab(0);
          return { symbol: state.symbol, results: resp.result.results };
        }
        const resp = await fetchSymbol(state.symbol);
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

  const [hover] = createResource(
    () => {
      const s = peekState();
      return hasLspPos(s) ? s : null;
    },
    async (state) => {
      try {
        const resp = await fetchHover(state.filePath, state.line, state.character);
        return resp.result;
      } catch {
        return null;
      }
    },
  );

  const [refs] = createResource(
    () => {
      const s = peekState();
      return hasLspPos(s) ? s : null;
    },
    async (state) => {
      try {
        const resp = await fetchReferences(state.filePath, state.line, state.character);
        return resp.result.references;
      } catch {
        return [];
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
    const s = peekState();
    if (hasLspPos(s)) {
      void cancelLspRequest('definition', s.filePath, s.line, s.character);
      void cancelLspRequest('hover', s.filePath, s.line, s.character);
      void cancelLspRequest('references', s.filePath, s.line, s.character);
    }
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

    const current = peekState();
    if (current) {
      // Nested peek: use name-search since we don't have a file position for the click inside the peek body.
      setPeekState({ ...current, symbol: word, line: undefined, character: undefined });
    }
  }

  function onDocClick(e: MouseEvent) {
    if (panelRef && !panelRef.contains(e.target as Node)) handleClose();
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

  const VISIBLE_REFS = 50;
  const visibleRefs = () => (showAllRefs() ? (refs() ?? []) : (refs() ?? []).slice(0, VISIBLE_REFS));

  return (
    <Show when={peekState() && data()?.results?.length}>
      <tr class="peek-row">
        <td colspan="3">
          <div class="peek-panel" ref={panelRef} onKeyDown={handleKeyDown} tabIndex={-1}>
            <div class="peek-header">
              <button class="peek-close" onClick={handleClose} title="Close (Esc)">
                ✕
              </button>
              <strong class="peek-symbol">{data()!.symbol}</strong>
              <Show when={activeResult()}>
                {(r) => (
                  <span class="peek-location">
                    {r().file}:{r().line}
                  </span>
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
                      <option value={i()}>
                        {result.file} :{result.line}
                      </option>
                    )}
                  </For>
                </select>
              </Show>
            </div>

            <Show when={hover()?.signature}>
              <div class="peek-hover">
                <div class="peek-hover-signature">{hover()!.signature}</div>
                <Show when={hover()?.docs}>
                  <div class="peek-hover-docs" innerHTML={renderMd(hover()!.docs!)} />
                </Show>
              </div>
            </Show>

            <Show when={activeResult()}>
              {(r) => (
                <>
                  <Show when={r().docstring && !hover()?.signature}>
                    <div class="peek-docstring">{r().docstring}</div>
                  </Show>
                  <pre class="peek-body" onClick={handleBodyClick}>
                    <code innerHTML={highlightBody(r())} />
                  </pre>
                </>
              )}
            </Show>

            <Show when={(refs() ?? []).length > 0}>
              <div class="peek-refs">
                <div class="peek-refs-header">References · {(refs() ?? []).length}</div>
                <For each={visibleRefs()}>
                  {(ref) => (
                    <div class="peek-ref">
                      <span class="peek-ref-loc">
                        {ref.file}:{ref.line}
                      </span>
                      <span class="peek-ref-snippet">{ref.snippet}</span>
                    </div>
                  )}
                </For>
                <Show when={(refs() ?? []).length > VISIBLE_REFS && !showAllRefs()}>
                  <button class="peek-refs-more" onClick={() => setShowAllRefs(true)}>
                    Show {(refs() ?? []).length - VISIBLE_REFS} more
                  </button>
                </Show>
              </div>
            </Show>

            <div class="peek-footer">Esc to close</div>
          </div>
        </td>
      </tr>
    </Show>
  );
}
