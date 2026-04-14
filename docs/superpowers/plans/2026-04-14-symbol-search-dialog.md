# Symbol Search Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JetBrains-style double-shift symbol search dialog that lets users look up symbol definitions by name.

**Architecture:** New `SymbolSearch.tsx` component rendered as a fixed-position overlay in `App.tsx`. Double-shift detection in `useKeyboardShortcuts.ts` toggles a `symbolSearchOpen` signal. The dialog reuses the existing `fetchSymbol` API and syntax highlighting utilities.

**Tech Stack:** SolidJS, TypeScript, CSS (existing variable system)

---

### Task 1: Add `symbolSearchOpen` signal to state

**Files:**
- Modify: `frontend/src/state.ts:127` (after `peekState` signal)

- [ ] **Step 1: Add the signal**

In `frontend/src/state.ts`, after the `peekState` line (line 127), add:

```ts
export const [symbolSearchOpen, setSymbolSearchOpen] = createSignal(false);
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/state.ts
git commit -m "feat: add symbolSearchOpen signal"
```

---

### Task 2: Add double-shift detection to keyboard shortcuts

**Files:**
- Modify: `frontend/src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Add `onSymbolSearch` to the Options interface**

In `frontend/src/hooks/useKeyboardShortcuts.ts`, update the `Options` interface:

```ts
interface Options {
  onRefresh: () => void;
  onToggleCommits: () => void;
  onJumpComment: (direction: 'next' | 'prev') => void;
  onSymbolSearch: () => void;
}
```

- [ ] **Step 2: Add double-shift detection**

Inside the `useKeyboardShortcuts` function body, before the existing `handler` function, add the double-shift tracker. It must use `keydown` and `keyup` to detect two quick Shift taps with no other keys in between. The existing `handler` on `keydown` already bails on input/textarea focus, so the double-shift detection needs its own `keyup` listener:

```ts
let lastShiftUp = 0;
let shiftDownClean = false; // true if Shift was pressed with no other keys

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Shift') {
    shiftDownClean = true;
  } else {
    // Any other key pressed while Shift is held = not a clean double-shift
    shiftDownClean = false;
  }
}

function onShiftUp(e: KeyboardEvent) {
  if (e.key !== 'Shift') return;
  if (!shiftDownClean) return;
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

  const now = Date.now();
  if (now - lastShiftUp < 300) {
    lastShiftUp = 0;
    options.onSymbolSearch();
  } else {
    lastShiftUp = now;
  }
}
```

- [ ] **Step 3: Register and clean up the listeners**

Update the `onMount` / `onCleanup` at the bottom of the function. The existing code is:

```ts
onMount(() => document.addEventListener('keydown', handler));
onCleanup(() => document.removeEventListener('keydown', handler));
```

Replace with:

```ts
onMount(() => {
  document.addEventListener('keydown', handler);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onShiftUp);
});
onCleanup(() => {
  document.removeEventListener('keydown', handler);
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onShiftUp);
});
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useKeyboardShortcuts.ts
git commit -m "feat: double-shift detection for symbol search"
```

---

### Task 3: Create the SymbolSearch component

**Files:**
- Create: `frontend/src/components/diff/SymbolSearch.tsx`

- [ ] **Step 1: Create the component file**

Create `frontend/src/components/diff/SymbolSearch.tsx`:

```tsx
import { createSignal, createResource, Show, For, onMount, onCleanup } from 'solid-js';
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
              <button class="symbol-search-back" onClick={() => {
                setPreviewResult(null);
                setPreviewResults([]);
                setPreviewSymbol('');
                setPreviewTab(0);
                inputRef?.focus();
              }}>Back</button>
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
                      <span class="symbol-search-result-location">{result.file}:{result.line}</span>
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
                  <span class="peek-location">{result().file}:{result().line}</span>
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
                        {(r, i) => <option value={i()}>{r.file}:{r.line}</option>}
                      </For>
                    </select>
                  </Show>
                </div>
                <Show when={result().docstring}>
                  <div class="peek-docstring">{result().docstring}</div>
                </Show>
                <pre class="peek-body" onClick={handlePreviewClick}><code innerHTML={highlightBody(result())} /></pre>
              </div>
            )}
          </Show>

          <div class="symbol-search-footer">
            <Show when={!previewResult()} fallback={<>Backspace to go back &middot; Cmd+Click to follow &middot; Esc to close</>}>
              &uarr;&darr; navigate &middot; Enter to select &middot; Esc to close
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/diff/SymbolSearch.tsx
git commit -m "feat: SymbolSearch dialog component"
```

---

### Task 4: Add CSS styles for the symbol search dialog

**Files:**
- Modify: `frontend/src/style.css` (append after peek panel styles, around line 1723)

- [ ] **Step 1: Add styles**

Append the following after the existing `.peek-footer` rules (after the peek panel section):

```css
/* --- Symbol Search Dialog --- */

.symbol-search-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 1000;
  display: flex;
  justify-content: center;
  padding-top: 15vh;
}

.symbol-search-dialog {
  width: 90vw;
  max-width: 600px;
  max-height: 70vh;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  align-self: flex-start;
}

.symbol-search-input-row {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
}

.symbol-search-input {
  flex: 1;
  background: var(--bg);
  border: none;
  color: var(--text);
  font-size: 14px;
  padding: 12px 16px;
  outline: none;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
.symbol-search-input::placeholder {
  color: var(--text-muted);
}

.symbol-search-back {
  background: none;
  border: none;
  border-left: 1px solid var(--border);
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  padding: 12px 16px;
}
.symbol-search-back:hover {
  background: var(--hover);
}

.symbol-search-results {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.symbol-search-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
}
.symbol-search-result:hover,
.symbol-search-result.selected {
  background: var(--hover);
}

.symbol-search-result-name {
  color: var(--text);
  font-weight: 600;
}

.symbol-search-result-kind {
  color: var(--text-muted);
  font-size: 11px;
  background: var(--bg-tertiary);
  padding: 1px 6px;
  border-radius: 3px;
}

.symbol-search-result-location {
  color: var(--accent);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  margin-left: auto;
}

.symbol-search-empty {
  padding: 24px 16px;
  color: var(--text-muted);
  text-align: center;
  font-size: 13px;
}

.symbol-search-preview {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}

.symbol-search-preview .peek-body {
  flex: 1;
  overflow: auto;
}

.symbol-search-footer {
  padding: 6px 16px;
  font-size: 11px;
  color: var(--text-muted);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat: symbol search dialog styles"
```

---

### Task 5: Wire up SymbolSearch in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add imports**

At the top of `App.tsx`, add:

```ts
import { symbolSearchOpen, setSymbolSearchOpen } from './state';
import SymbolSearch from './components/diff/SymbolSearch';
```

- [ ] **Step 2: Wire up the keyboard shortcut callback**

Update the `useKeyboardShortcuts` call (around line 239) from:

```ts
useKeyboardShortcuts({
  onRefresh: handleRefresh,
  onToggleCommits: () => setCommitPanelOpen(!commitPanelOpen()),
  onJumpComment: jumpToComment,
});
```

to:

```ts
useKeyboardShortcuts({
  onRefresh: handleRefresh,
  onToggleCommits: () => setCommitPanelOpen(!commitPanelOpen()),
  onJumpComment: jumpToComment,
  onSymbolSearch: () => setSymbolSearchOpen(!symbolSearchOpen()),
});
```

- [ ] **Step 3: Add SymbolSearch to the JSX**

In the return JSX, add `<SymbolSearch />` right before the closing `</>`. Place it after the last `<Show>` block (the keyboard-hint for file mode) and before `</>`:

```tsx
      <SymbolSearch />
    </>
```

- [ ] **Step 4: Add Shift+Shift to the keyboard hint**

Update the diff-mode keyboard hint to include the new shortcut. Change:

```tsx
<kbd>n</kbd>/<kbd>p</kbd> next/prev comment
```

to:

```tsx
<kbd>n</kbd>/<kbd>p</kbd> next/prev comment &middot; <kbd>Shift Shift</kbd> symbol search
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: wire up SymbolSearch in App"
```

---

### Task 6: Build and verify

**Files:**
- None (build check only)

- [ ] **Step 1: Build the frontend**

```bash
cd frontend && npx vite build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Manual smoke test**

Run the dev server and verify:
1. Double-tap Shift opens the dialog
2. Typing a symbol name shows results after a brief debounce
3. Arrow keys navigate results, Enter shows the definition preview
4. Backspace in preview returns to results
5. Esc closes the dialog at any point
6. Clicking outside closes the dialog
7. Cmd+click in the preview body navigates to the clicked symbol
8. Double-shift while dialog is open closes it

- [ ] **Step 3: Commit the built dist**

```bash
git add frontend/dist
git commit -m "build: rebuild frontend dist with symbol search"
```
