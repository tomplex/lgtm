# Peek Definition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cmd+click a symbol in the diff view to see its definition in an inline peek panel, powered by server-side ripgrep.

**Architecture:** New server module `symbol-lookup.ts` handles ripgrep-based symbol search and body extraction. New Express route `/symbol` exposes it. New SolidJS component `PeekPanel.tsx` renders the peek inline below the clicked diff line. State is a single signal in `state.ts`.

**Tech Stack:** ripgrep (rg), Express, SolidJS, highlight.js

---

### Task 1: Symbol Lookup Module — Python Patterns

**Files:**
- Create: `server/symbol-lookup.ts`
- Test: `server/__tests__/symbol-lookup.test.ts`

This task builds the core lookup logic for Python. The module exports a `findSymbol()` function that runs ripgrep against a repo, then reads each matching file to extract the full definition body.

- [ ] **Step 1: Write failing test for Python function lookup**

In `server/__tests__/symbol-lookup.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { findSymbol } from '../symbol-lookup.js';

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'sym-test-'));
  execFileSync('git', ['init'], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('findSymbol', () => {
  let repo: string;

  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  it('finds a Python function with docstring', () => {
    repo = makeRepo({
      'utils/parsing.py': [
        'import json',
        '',
        'def parse_analysis(raw_text: str) -> dict:',
        '    """Parse raw markdown analysis into structured JSON."""',
        '    sections = raw_text.split("## ")',
        '    result = {}',
        '    for section in sections:',
        '        if not section.strip():',
        '            continue',
        '    return result',
        '',
        'def other_func():',
        '    pass',
      ].join('\n'),
    });

    const results = findSymbol(repo, 'parse_analysis');
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe('utils/parsing.py');
    expect(results[0].line).toBe(3);
    expect(results[0].kind).toBe('function');
    expect(results[0].body).toContain('def parse_analysis');
    expect(results[0].body).toContain('return result');
    expect(results[0].docstring).toBe('Parse raw markdown analysis into structured JSON.');
  });

  it('finds a Python class', () => {
    repo = makeRepo({
      'models.py': [
        'class ReviewSession:',
        '    """Represents a code review session."""',
        '',
        '    def __init__(self, repo_path: str):',
        '        self.repo_path = repo_path',
        '        self.comments = []',
        '',
        '    def add_comment(self, text: str):',
        '        self.comments.append(text)',
        '',
        'class Other:',
        '    pass',
      ].join('\n'),
    });

    const results = findSymbol(repo, 'ReviewSession');
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('class');
    expect(results[0].body).toContain('class ReviewSession');
    expect(results[0].body).toContain('self.comments.append(text)');
    expect(results[0].body).not.toContain('class Other');
    expect(results[0].docstring).toBe('Represents a code review session.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:server -- --testPathPattern symbol-lookup`
Expected: FAIL — cannot find `../symbol-lookup.js`

- [ ] **Step 3: Implement findSymbol for Python**

Create `server/symbol-lookup.ts`:

```typescript
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SymbolResult {
  file: string;
  line: number;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable';
  body: string;
  docstring: string | null;
}

interface RgMatch {
  file: string;
  line: number;
  kind: SymbolResult['kind'];
}

const PYTHON_PATTERNS: Array<{ pattern: string; kind: SymbolResult['kind'] }> = [
  { pattern: '^\\s*(def)\\s+{symbol}\\b', kind: 'function' },
  { pattern: '^\\s*(class)\\s+{symbol}\\b', kind: 'class' },
];

const TS_PATTERNS: Array<{ pattern: string; kind: SymbolResult['kind'] }> = [
  { pattern: '^\\s*(export\\s+)?(function)\\s+{symbol}\\b', kind: 'function' },
  { pattern: '^\\s*(export\\s+)?(class)\\s+{symbol}\\b', kind: 'class' },
  { pattern: '^\\s*(export\\s+)?(interface)\\s+{symbol}\\b', kind: 'interface' },
  { pattern: '^\\s*(export\\s+)?(type)\\s+{symbol}\\b', kind: 'type' },
  { pattern: '^\\s*(export\\s+)?(const|let)\\s+{symbol}\\b', kind: 'variable' },
  { pattern: '^\\s*(export\\s+)?{symbol}\\s*[=(]', kind: 'variable' },
];

function rgSearch(repoPath: string, symbol: string): RgMatch[] {
  const allPatterns = [...PYTHON_PATTERNS, ...TS_PATTERNS];
  const results: RgMatch[] = [];

  for (const { pattern, kind } of allPatterns) {
    const regex = pattern.replace('{symbol}', symbol);
    try {
      const output = execFileSync('rg', [
        '--line-number',
        '--no-heading',
        '--no-filename',
        '-n',
        regex,
        '--glob', '*.py',
        '--glob', '*.ts',
        '--glob', '*.tsx',
        '--glob', '*.js',
        '--glob', '*.jsx',
        '.',
      ], {
        cwd: repoPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      // rg output: LINE_NUM:content
      // We need file paths too, so use --with-filename
    } catch {
      // rg exits 1 when no matches
    }
  }

  return results;
}

function rgSearchAll(repoPath: string, symbol: string): RgMatch[] {
  const allPatterns = [...PYTHON_PATTERNS, ...TS_PATTERNS];
  const results: RgMatch[] = [];
  const seen = new Set<string>();

  for (const { pattern, kind } of allPatterns) {
    const regex = pattern.replace('{symbol}', symbol);
    try {
      const output = execFileSync('rg', [
        '--line-number',
        '--with-filename',
        '--no-heading',
        regex,
        '--glob', '*.py',
        '--glob', '*.ts',
        '--glob', '*.tsx',
        '--glob', '*.js',
        '--glob', '*.jsx',
      ], {
        cwd: repoPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      for (const line of output.split('\n')) {
        if (!line) continue;
        // Format: filepath:linenum:content
        const match = line.match(/^(.+?):(\d+):/);
        if (!match) continue;
        const file = match[1];
        const lineNum = parseInt(match[2]);
        const key = `${file}:${lineNum}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ file, line: lineNum, kind });
      }
    } catch {
      // rg exits 1 when no matches
    }
  }

  return results;
}

function extractPythonBody(lines: string[], startIdx: number): string {
  // Start line is the def/class line
  const defLine = lines[startIdx];
  const defIndent = defLine.match(/^(\s*)/)?.[1].length ?? 0;
  const bodyIndent = defIndent + 1; // at least one more level

  const bodyLines = [defLine];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // Empty lines are part of the body
    if (line.trim() === '') {
      bodyLines.push(line);
      continue;
    }
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent <= defIndent) break;
    bodyLines.push(line);
  }

  // Trim trailing blank lines
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') {
    bodyLines.pop();
  }

  return bodyLines.join('\n');
}

function extractTsBody(lines: string[], startIdx: number): string {
  const startLine = lines[startIdx];
  const bodyLines = [startLine];

  // Track brace depth
  let braceDepth = 0;
  let foundOpen = false;

  for (let i = startIdx; i < lines.length; i++) {
    if (i > startIdx) bodyLines.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') {
        braceDepth++;
        foundOpen = true;
      } else if (ch === '}') {
        braceDepth--;
      }
    }
    if (foundOpen && braceDepth <= 0) break;

    // For type aliases and single-line const, stop at semicolon or next blank line
    if (!foundOpen && i > startIdx) {
      if (lines[i].includes(';')) break;
      // Multiline type/const without braces — stop at dedent or blank
      if (lines[i].trim() === '') break;
    }
  }

  return bodyLines.join('\n');
}

function extractDocstring(lines: string[], defLineIdx: number): string | null {
  // Python: look at line after def for triple-quote docstring
  const nextIdx = defLineIdx + 1;
  if (nextIdx >= lines.length) return null;
  const nextLine = lines[nextIdx].trim();

  // Triple-quoted single-line docstring
  if (nextLine.startsWith('"""') && nextLine.endsWith('"""') && nextLine.length > 6) {
    return nextLine.slice(3, -3);
  }
  if (nextLine.startsWith("'''") && nextLine.endsWith("'''") && nextLine.length > 6) {
    return nextLine.slice(3, -3);
  }

  // Multi-line docstring
  if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
    const quote = nextLine.slice(0, 3);
    const parts = [nextLine.slice(3)];
    for (let i = nextIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.includes(quote)) {
        parts.push(trimmed.replace(quote, ''));
        break;
      }
      parts.push(trimmed);
    }
    return parts.join('\n').trim();
  }

  return null;
}

function extractJsDoc(lines: string[], defLineIdx: number): string | null {
  // Look backwards from def line for /** ... */
  let i = defLineIdx - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return null;

  if (!lines[i].trim().endsWith('*/')) return null;

  const endIdx = i;
  while (i >= 0 && !lines[i].trim().startsWith('/**')) i--;
  if (i < 0) return null;

  const docLines = lines.slice(i, endIdx + 1);
  return docLines
    .map(l => l.trim().replace(/^\/\*\*\s?/, '').replace(/\s?\*\/$/, '').replace(/^\*\s?/, ''))
    .filter(l => l)
    .join('\n')
    .trim();
}

function isPythonFile(file: string): boolean {
  return file.endsWith('.py');
}

export function findSymbol(repoPath: string, symbol: string): SymbolResult[] {
  const matches = rgSearchAll(repoPath, symbol);
  const results: SymbolResult[] = [];

  for (const match of matches) {
    const fullPath = join(repoPath, match.file);
    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    const lineIdx = match.line - 1; // 0-indexed

    const python = isPythonFile(match.file);
    const body = python
      ? extractPythonBody(lines, lineIdx)
      : extractTsBody(lines, lineIdx);
    const docstring = python
      ? extractDocstring(lines, lineIdx)
      : extractJsDoc(lines, lineIdx);

    results.push({
      file: match.file,
      line: match.line,
      kind: match.kind,
      body,
      docstring,
    });
  }

  return results.slice(0, 10);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:server -- --testPathPattern symbol-lookup`
Expected: PASS (both Python tests)

- [ ] **Step 5: Commit**

```bash
git add server/symbol-lookup.ts server/__tests__/symbol-lookup.test.ts
git commit -m "add symbol lookup module with Python support"
```

---

### Task 2: Symbol Lookup Module — TypeScript Patterns

**Files:**
- Modify: `server/__tests__/symbol-lookup.test.ts`
- (No new source needed — TS patterns already in module)

- [ ] **Step 1: Write failing tests for TypeScript patterns**

Append to `server/__tests__/symbol-lookup.test.ts` inside the `describe('findSymbol')` block:

```typescript
  it('finds a TypeScript function', () => {
    repo = makeRepo({
      'src/utils.ts': [
        'export function escapeHtml(str: string): string {',
        '  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;");',
        '}',
        '',
        'export function other() {',
        '  return 1;',
        '}',
      ].join('\n'),
    });

    const results = findSymbol(repo, 'escapeHtml');
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe('src/utils.ts');
    expect(results[0].kind).toBe('function');
    expect(results[0].body).toContain('export function escapeHtml');
    expect(results[0].body).toContain('return str.replace');
    expect(results[0].body).not.toContain('export function other');
  });

  it('finds a TypeScript interface', () => {
    repo = makeRepo({
      'src/types.ts': [
        '/** A line in a diff. */',
        'export interface DiffLine {',
        '  type: "add" | "del" | "context";',
        '  content: string;',
        '  oldLine: number | null;',
        '  newLine: number | null;',
        '}',
      ].join('\n'),
    });

    const results = findSymbol(repo, 'DiffLine');
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('interface');
    expect(results[0].body).toContain('export interface DiffLine');
    expect(results[0].body).toContain('newLine: number | null;');
    expect(results[0].docstring).toBe('A line in a diff.');
  });

  it('finds an arrow function const', () => {
    repo = makeRepo({
      'src/api.ts': [
        'export const fetchData = async (url: string): Promise<Response> => {',
        '  const resp = await fetch(url);',
        '  return resp;',
        '};',
      ].join('\n'),
    });

    const results = findSymbol(repo, 'fetchData');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].body).toContain('fetchData');
    expect(results[0].body).toContain('return resp');
  });

  it('returns empty array for unknown symbol', () => {
    repo = makeRepo({
      'src/empty.ts': 'export const x = 1;\n',
    });

    const results = findSymbol(repo, 'nonExistentSymbol');
    expect(results).toHaveLength(0);
  });

  it('caps results at 10', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 15; i++) {
      files[`src/mod${i}.ts`] = `export function dup() {\n  return ${i};\n}\n`;
    }
    repo = makeRepo(files);

    const results = findSymbol(repo, 'dup');
    expect(results.length).toBeLessThanOrEqual(10);
  });
```

- [ ] **Step 2: Run tests to verify they fail/pass**

Run: `npm run test:server -- --testPathPattern symbol-lookup`
Expected: All tests pass (TS patterns already implemented in Task 1). If any fail, fix the extraction logic.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/symbol-lookup.test.ts
git commit -m "add TypeScript symbol lookup tests"
```

---

### Task 3: Server Route

**Files:**
- Modify: `server/app.ts` (add route after line 148)

- [ ] **Step 1: Write the route**

In `server/app.ts`, add this import at the top with the other imports:

```typescript
import { findSymbol } from './symbol-lookup.js';
```

Add the route after the `/analysis` route (after line 148, before the `// --- User state routes ---` comment):

```typescript
  projectRouter.get('/symbol', (req, res) => {
    const session = res.locals.session;
    const name = (req.query.name as string) ?? '';
    if (!name) {
      res.json({ symbol: '', results: [] });
      return;
    }
    const results = findSymbol(session.repoPath, name);
    res.json({ symbol: name, results });
  });
```

- [ ] **Step 2: Build the server to verify compilation**

Run: `npm run build:server`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/app.ts
git commit -m "add GET /symbol route for peek definition"
```

---

### Task 4: Sort Results — Diff Files First

**Files:**
- Modify: `server/symbol-lookup.ts`
- Modify: `server/__tests__/symbol-lookup.test.ts`

The spec says results should be sorted with files in the diff first, then alphabetically. The route passes `diffFiles` so the lookup module can sort.

- [ ] **Step 1: Write failing test**

Add to `server/__tests__/symbol-lookup.test.ts`:

```typescript
import { findSymbol, sortResults } from '../symbol-lookup.js';

describe('sortResults', () => {
  it('sorts diff files first, then alphabetical', () => {
    const results = [
      { file: 'z/last.py', line: 1, kind: 'function' as const, body: '', docstring: null },
      { file: 'a/first.py', line: 1, kind: 'function' as const, body: '', docstring: null },
      { file: 'm/middle.py', line: 1, kind: 'function' as const, body: '', docstring: null },
    ];
    const diffFiles = new Set(['m/middle.py']);
    const sorted = sortResults(results, diffFiles);
    expect(sorted.map(r => r.file)).toEqual(['m/middle.py', 'a/first.py', 'z/last.py']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:server -- --testPathPattern symbol-lookup`
Expected: FAIL — `sortResults` not exported

- [ ] **Step 3: Implement sortResults**

In `server/symbol-lookup.ts`, add and export:

```typescript
export function sortResults(results: SymbolResult[], diffFiles: Set<string>): SymbolResult[] {
  return results.slice().sort((a, b) => {
    const aInDiff = diffFiles.has(a.file) ? 0 : 1;
    const bInDiff = diffFiles.has(b.file) ? 0 : 1;
    if (aInDiff !== bInDiff) return aInDiff - bInDiff;
    return a.file.localeCompare(b.file);
  });
}
```

- [ ] **Step 4: Wire sorting into the route**

Update the `/symbol` route in `server/app.ts`:

```typescript
  projectRouter.get('/symbol', (req, res) => {
    const session = res.locals.session;
    const name = (req.query.name as string) ?? '';
    if (!name) {
      res.json({ symbol: '', results: [] });
      return;
    }
    const results = findSymbol(session.repoPath, name);
    const diffFiles = new Set(session.diffFiles ?? []);
    const sorted = sortResults(results, diffFiles);
    res.json({ symbol: name, results: sorted });
  });
```

Add `sortResults` to the import from `./symbol-lookup.js`.

⚠️ `session.diffFiles` may not exist yet. Check `server/session.ts` for how diff files are tracked. If the session already stores parsed diff file paths, use that. If not, extract file paths from the raw diff on the fly — the `/data` endpoint already does this. Alternatively, pass an empty set and sort purely alphabetically for now (the frontend already has the diff file list and could do this client-side too). Use whatever approach is simplest given what the session already exposes.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:server -- --testPathPattern symbol-lookup`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/symbol-lookup.ts server/__tests__/symbol-lookup.test.ts server/app.ts
git commit -m "sort symbol results with diff files first"
```

---

### Task 5: Frontend API + State

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/state.ts`

- [ ] **Step 1: Add the SymbolResult type and API function**

In `frontend/src/api.ts`, add the type and fetch function:

```typescript
export interface SymbolResult {
  file: string;
  line: number;
  kind: string;
  body: string;
  docstring: string | null;
}

interface SymbolResponse {
  symbol: string;
  results: SymbolResult[];
}

export async function fetchSymbol(name: string): Promise<SymbolResponse> {
  const resp = await fetch(`${baseUrl()}/symbol?name=${encodeURIComponent(name)}`);
  return checkedJson<SymbolResponse>(resp);
}
```

- [ ] **Step 2: Add peek state signal**

In `frontend/src/state.ts`, add after the existing signals (after line 85):

```typescript
export interface PeekState {
  filePath: string;
  lineIdx: number;
  symbol: string;
}

export const [peekState, setPeekState] = createSignal<PeekState | null>(null);
```

- [ ] **Step 3: Build frontend to verify compilation**

Run: `npx tsc -p frontend/tsconfig.json --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.ts frontend/src/state.ts
git commit -m "add symbol API client and peek state signal"
```

---

### Task 6: PeekPanel Component

**Files:**
- Create: `frontend/src/components/diff/PeekPanel.tsx`

- [ ] **Step 1: Create the PeekPanel component**

Create `frontend/src/components/diff/PeekPanel.tsx`:

```tsx
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

  // Close on Escape
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleClose();
    }
  }

  // Close on click outside
  function handleClickOutside(e: MouseEvent) {
    const panel = (e.target as HTMLElement).closest('.peek-panel');
    if (!panel) handleClose();
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
```

- [ ] **Step 2: Build to verify compilation**

Run: `npx tsc -p frontend/tsconfig.json --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/diff/PeekPanel.tsx
git commit -m "add PeekPanel component"
```

---

### Task 7: Wire PeekPanel into DiffLine

**Files:**
- Modify: `frontend/src/components/diff/DiffLine.tsx`

- [ ] **Step 1: Add cmd+click handling and render PeekPanel**

In `DiffLine.tsx`, add imports:

```typescript
import { peekState, setPeekState } from '../../state';
import PeekPanel from './PeekPanel';
```

Replace the existing `handleLineClick` function (lines 52-58) with:

```typescript
  function getWordAtClick(e: MouseEvent): string | null {
    const sel = document.caretPositionFromPoint?.(e.clientX, e.clientY)
      ?? (document as any).caretRangeFromPoint?.(e.clientX, e.clientY);
    if (!sel) return null;

    const node = 'offsetNode' in sel ? sel.offsetNode : sel.startContainer;
    const offset = 'offset' in sel ? sel.offset : sel.startOffset;
    if (node.nodeType !== Node.TEXT_NODE) return null;

    const text = node.textContent ?? '';
    // Walk backwards and forwards from offset to find word boundary
    let start = offset;
    let end = offset;
    while (start > 0 && /[\w]/.test(text[start - 1])) start--;
    while (end < text.length && /[\w]/.test(text[end])) end++;

    const word = text.slice(start, end);
    // Must be a plausible identifier (at least 2 chars, starts with letter or _)
    if (word.length < 2 || !/^[a-zA-Z_]/.test(word)) return null;
    return word;
  }

  function handleLineClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.comment-box') || (e.target as HTMLElement).closest('.claude-comment'))
      return;
    if ((e.target as HTMLElement).closest('.peek-panel')) return;

    // Cmd+click: symbol lookup
    if (e.metaKey || e.ctrlKey) {
      const word = getWordAtClick(e);
      if (word) {
        setPeekState({ filePath: props.filePath, lineIdx: props.lineIdx, symbol: word });
      }
      return;
    }

    const existingUserComment = lineComments().find((c) => c.author === 'user' && c.mode === 'review');
    if (existingUserComment) return;
    setShowNewComment(true);
  }
```

In the JSX return, add PeekPanel after the line's `<tr>` and before the comments `<For>` block. The peek should show when `peekState()` matches this line:

```tsx
  const showPeek = () => {
    const p = peekState();
    return p && p.filePath === props.filePath && p.lineIdx === props.lineIdx;
  };
```

Add this right after the closing `</tr>` of the diff line (before the `<For each={lineComments()}>` block):

```tsx
      <Show when={showPeek()}>
        <PeekPanel />
      </Show>
```

- [ ] **Step 2: Build to verify compilation**

Run: `npx tsc -p frontend/tsconfig.json --noEmit`
Expected: No errors

- [ ] **Step 3: Manual test**

Run: `npm run dev:all`
Open the LGTM UI, navigate to a diff file. Hold Cmd and click on a function name. Verify:
- Peek panel appears below the line
- Shows the definition with syntax highlighting
- Esc closes it
- Clicking elsewhere closes it
- If no definition found, toast appears

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/diff/DiffLine.tsx
git commit -m "wire cmd+click symbol lookup into diff lines"
```

---

### Task 8: Peek Panel CSS

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Add peek panel styles**

Append to `frontend/src/style.css`:

```css
/* --- Peek Definition Panel --- */

.peek-row td {
  padding: 0 !important;
}

.peek-panel {
  margin: 4px 12px 4px 60px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  overflow: hidden;
  outline: none;
  max-height: 400px;
  display: flex;
  flex-direction: column;
}

.peek-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  flex-shrink: 0;
}

.peek-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
  line-height: 1;
}
.peek-close:hover {
  color: var(--del-text);
}

.peek-symbol {
  color: var(--text);
}

.peek-location {
  color: var(--accent);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
}

.peek-tabs {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.peek-tab {
  background: none;
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.peek-tab:hover {
  color: var(--text);
  background: var(--hover);
}
.peek-tab.active {
  color: var(--text);
  border-color: var(--accent);
  background: var(--bg);
}

.peek-docstring {
  padding: 8px 12px;
  color: var(--text-muted);
  font-style: italic;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.peek-body {
  margin: 0;
  padding: 8px 12px;
  overflow: auto;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  line-height: 20px;
  flex: 1;
  min-height: 0;
}
.peek-body code {
  background: none;
}

.peek-footer {
  padding: 4px 12px;
  font-size: 11px;
  color: var(--text-muted);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

/* Cmd+hover underline hint on code identifiers */
.line-content:hover {
  cursor: default;
}
```

- [ ] **Step 2: Visual test**

Run the dev server, open the UI, trigger a peek. Verify:
- Panel appears with dark background, rounded corners
- Close button on left side, symbol name and file path in header
- Tabs visible when multiple results
- Code is syntax highlighted in the body
- Scrollable if body is long
- Fits within the diff view width

- [ ] **Step 3: Commit**

```bash
git add frontend/src/style.css
git commit -m "add peek panel styles"
```

---

### Task 9: Cmd+Hover Underline Hint

**Files:**
- Modify: `frontend/src/components/diff/DiffLine.tsx`
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Add CSS for cmd+hover underline**

Append to `frontend/src/style.css`:

```css
/* Body gets this class when Cmd is held */
body.cmd-held .line-content .hljs-title,
body.cmd-held .line-content .hljs-title.function_,
body.cmd-held .line-content .hljs-attr,
body.cmd-held .line-content .hljs-built_in,
body.cmd-held .line-content .hljs-type {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--text-muted);
  cursor: pointer;
}
```

- [ ] **Step 2: Add Cmd key tracking**

In `DiffLine.tsx` (or in a shared hook if you prefer), add global Cmd key tracking. Since this should be global, add it in `frontend/src/main.tsx` at the top level:

```typescript
// Track Cmd key for peek-definition underline hint
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey) document.body.classList.add('cmd-held');
});
document.addEventListener('keyup', (e) => {
  if (!e.metaKey && !e.ctrlKey) document.body.classList.remove('cmd-held');
});
window.addEventListener('blur', () => {
  document.body.classList.remove('cmd-held');
});
```

- [ ] **Step 3: Manual test**

Open the diff UI, hold Cmd/Ctrl. Verify function names and type names in highlighted code get a dotted underline. Release Cmd — underlines disappear.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/style.css frontend/src/main.tsx
git commit -m "add cmd+hover underline hint for peekable symbols"
```

---

### Task 10: Nested Peek + Click-Outside Dismiss

**Files:**
- Modify: `frontend/src/components/diff/PeekPanel.tsx`

The spec says cmd+click inside the peek panel should replace the peek content (nested peek). Click outside should dismiss.

- [ ] **Step 1: Add cmd+click handling inside the peek body**

In `PeekPanel.tsx`, add a click handler on the `<pre class="peek-body">` element:

```tsx
  function handleBodyClick(e: MouseEvent) {
    if (!(e.metaKey || e.ctrlKey)) return;

    // Reuse the same word-at-click logic
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

    // Replace current peek — keep same position, change symbol
    const current = peekState();
    if (current) {
      setPeekState({ ...current, symbol: word });
    }
  }
```

Add `onClick={handleBodyClick}` to the `<pre class="peek-body">` element.

- [ ] **Step 2: Add click-outside dismiss**

In `PeekPanel.tsx`, add a global click listener when the panel mounts:

```typescript
import { onMount, onCleanup } from 'solid-js';

// Inside the component:
  let panelRef: HTMLDivElement | undefined;

  function onDocClick(e: MouseEvent) {
    if (panelRef && !panelRef.contains(e.target as Node)) {
      handleClose();
    }
  }

  onMount(() => {
    // Delay to avoid the triggering click from immediately closing
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
  });
  onCleanup(() => document.removeEventListener('click', onDocClick));
```

Update the `ref` on the `.peek-panel` div to use `panelRef`:

```tsx
<div class="peek-panel" ref={panelRef} ...>
```

- [ ] **Step 3: Manual test**

Open peek on a symbol. Cmd+click a symbol inside the peek body — peek should update to show the new symbol's definition. Click outside the peek — it should close.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/diff/PeekPanel.tsx
git commit -m "add nested peek and click-outside dismiss"
```

---

### Task 11: Build & Smoke Test

**Files:**
- None new — verify everything works end-to-end

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Build everything**

Run: `npm run build:server && npm run build:frontend`
Expected: No errors

- [ ] **Step 3: End-to-end smoke test**

Start the server with a real repo. Open the review UI. Test:
1. Cmd+hover shows dotted underlines on identifiers
2. Cmd+click on a Python function → peek shows definition with docstring
3. Cmd+click on a TS function → peek shows definition with JSDoc
4. Esc closes the peek
5. Click outside closes the peek
6. Cmd+click inside peek body → nested peek replaces content
7. Multiple results → tabs in header, clicking switches between them
8. Unknown symbol → "No definition found" toast
9. Peek doesn't interfere with normal line-click commenting

- [ ] **Step 4: Commit any fixes from smoke test**

```bash
git add -u
git commit -m "fix issues from peek definition smoke test"
```

(Skip this step if no fixes needed.)

---

Plan complete and saved to `docs/superpowers/plans/2026-04-02-peek-definition.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?