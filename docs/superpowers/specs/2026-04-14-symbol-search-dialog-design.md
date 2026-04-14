# Symbol Search Dialog

## Overview

Add a JetBrains-style double-shift symbol search dialog that lets users search for symbols by name instead of only Cmd+clicking in the diff. The dialog reuses the existing `/symbol` endpoint and peek panel aesthetics.

## Trigger

Double-tap Shift within 300ms. A single Shift keypress does nothing. The detection tracks `keyup` events for the Shift key — if two Shift releases occur within 300ms with no other keys pressed in between, the dialog opens. When the dialog is already open, double-shift closes it.

Detection lives in `useKeyboardShortcuts.ts` alongside existing shortcut handling.

## State

New signal in `state.ts`:

```ts
export const [symbolSearchOpen, setSymbolSearchOpen] = createSignal(false);
```

## Component: `SymbolSearch.tsx`

New file at `frontend/src/components/diff/SymbolSearch.tsx`. Rendered at the top level in `App.tsx`, outside the diff view — it's a fixed-position overlay, not anchored to a diff line.

### Three visual states

**1. Search input**

- Text input with placeholder "Search symbol...", auto-focused on open
- As the user types, results fetch after 200ms debounce via `fetchSymbol(query)`
- Empty query shows nothing below the input

**2. Results list**

- Each result row shows: symbol name (bold), file path and line number (muted)
- Arrow keys navigate the list, Enter selects, Esc closes the dialog
- If no results found, show "No results" text

**3. Definition preview**

- Selecting a result shows the full definition in the same dialog
- Header: symbol name (bold) + `file:line` (accent color)
- Docstring section if present (muted, italic)
- Syntax-highlighted body using existing `highlightLine`/`detectLang` utilities
- When multiple results exist for a symbol, show a dropdown to switch between them (same as existing PeekPanel)
- Cmd+click within the body triggers a new search for the clicked word (replaces the current query)
- Backspace when the input is empty, or a "Back" button, returns to the results list

### Keyboard behavior

| Key | Search state | Results state | Preview state |
|-----|-------------|--------------|---------------|
| Esc | Close dialog | Close dialog | Close dialog |
| Enter | Select first result | Select highlighted result | — |
| ArrowUp/Down | — | Navigate results | — |
| Backspace (empty input) | Close dialog | — | Back to results |
| Shift+Shift | Close dialog | Close dialog | Close dialog |

### Dismiss behavior

- Clicking outside the dialog closes it
- Esc at any state closes it
- Double-shift toggles it closed

## Styling

Fixed-position centered overlay with a semi-transparent backdrop (`rgba(0,0,0,0.3)`).

Dialog box:
- `max-width: 600px`, `width: 90vw`
- `max-height: 70vh` with overflow scroll on the body
- Uses existing CSS variables: `--surface` background, `--border` borders, `--accent` for highlights, `--text` and `--text-muted` for typography
- Border-radius and box-shadow consistent with existing `.peek-panel`
- Search input styled to match existing inputs in the app
- Selected result row highlighted with `--accent` at low opacity

Class prefix: `.symbol-search-*`

## Server

No changes. Reuses existing `GET /symbol?name=...` endpoint which already does substring/exact matching via `findSymbol()`.

## Integration

- `SymbolSearch` component rendered in `App.tsx` at the top level (sibling to existing layout), gated on `symbolSearchOpen()`
- `useKeyboardShortcuts` gets a new `onSymbolSearch` callback in its options, which toggles `symbolSearchOpen`
- Double-shift detection added to the existing `handler` function in `useKeyboardShortcuts.ts` using `keyup` events for Shift

## Files changed

| File | Change |
|------|--------|
| `frontend/src/state.ts` | Add `symbolSearchOpen` signal |
| `frontend/src/hooks/useKeyboardShortcuts.ts` | Add double-shift detection, new `onSymbolSearch` option |
| `frontend/src/components/diff/SymbolSearch.tsx` | New component |
| `frontend/src/style.css` | Add `.symbol-search-*` styles |
| `frontend/src/App.tsx` | Render `SymbolSearch`, wire up `onSymbolSearch` callback |
