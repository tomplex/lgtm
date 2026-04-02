# Peek Definition

## Background

LGTM shows diffs with syntax highlighting and inline commenting, but there's no way to look up what a symbol actually does without leaving the browser. During review you're constantly asking "what does this function do?" - whether it was changed in the diff or not. Right now the answer is "go find it in your editor," which breaks the flow.

## Goal

Cmd+click a symbol in the diff view, get a peek panel showing its definition inline - signature, body, docstring, syntax highlighted. No file management, no navigation, no IDE. Just "show me what this thing does" and get back to reviewing.

## Approach

Server-side ripgrep with language-aware patterns. No indexing, no caching, no tree-sitter (yet). Every lookup is a fresh grep against the repo. This is the simplest thing that works - ripgrep is fast enough that even large repos respond in single-digit milliseconds.

⭐ Tree-sitter upgrade path: the server API is designed so the frontend doesn't care how definitions are resolved. Swapping in tree-sitter later changes the server internals without touching the client.

## Interaction

**Trigger:** Hold Cmd, hover over code in the diff - identifiers get a dotted underline to signal clickability. Cmd+click fires the lookup.

**Peek panel:** Appears inline below the clicked line. Contains:
- Header: close button (left side), symbol name, file path + line number
- Body: full function/class definition with syntax highlighting via highlight.js
- Footer: "Esc to close" hint

**Multiple results:** If ripgrep finds the symbol defined in multiple places (e.g. `parse` in 3 files), tab bar in the header to cycle between them. Results sorted with diff files first, then alphabetical.

**Dismiss:** Esc, click outside, or close button.

**Nested peek:** Cmd+click on a symbol inside the peek panel replaces the peek content. No stacking - keeps it simple.

## Server API

Single new endpoint on the existing project-scoped router:

```
GET /project/:slug/symbol?name=parse_analysis
```

Response:

```json
{
  "symbol": "parse_analysis",
  "results": [
    {
      "file": "utils/parsing.py",
      "line": 47,
      "kind": "function",
      "body": "def parse_analysis(raw_text: str) -> dict[str, Any]:\n    \"\"\"Parse raw markdown analysis...\"\"\"\n    ...",
      "docstring": "Parse raw markdown analysis into structured JSON."
    }
  ]
}
```

Capped at 10 results.

### Symbol patterns

**Python:** `^\s*(def|class)\s+{symbol}`

**TypeScript:** `^\s*(export\s+)?(function|class|interface|type|const|let)\s+{symbol}` plus `{symbol}\s*[=(]` for arrow functions.

When a match is found, the server reads the file and extracts the full definition body - indentation-based for Python, brace matching for TS - plus any preceding docstring/JSDoc.

## Frontend

**Symbol detection:** No pre-indexing. Any word that looks like an identifier (not a keyword, not inside a string literal) becomes cmd+clickable. The lookup happens on click - if nothing is found, a brief "no definition found" toast.

**PeekPanel component:** New SolidJS component rendered inline in the diff. Inserted below the clicked line's `<tr>`.

**State:** Single signal `peekState: { filePath, lineIdx, symbol } | null`. When set, the DiffLine at that position renders PeekPanel below itself. Only one peek open at a time.

## Scope

**In:**
- Server endpoint with ripgrep-based symbol lookup for Python and TS
- Cmd+hover underline hint, cmd+click to trigger
- Inline peek panel with syntax highlighting, close button on left, esc to dismiss
- Multiple results with tab cycling
- Nested peek (replaces content, no stacking)

**Out:**
- Pre-indexing or caching (every lookup is a fresh grep)
- Languages beyond Python and TypeScript
- Tree-sitter (noted in TODO for future upgrade)
- "Open full file" navigation from the peek panel
- Symbol detection in document/markdown tabs (diff view only)
