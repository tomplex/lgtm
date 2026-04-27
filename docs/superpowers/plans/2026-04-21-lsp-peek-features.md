# LSP Peek Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ripgrep-based `/symbol` peek with an LSP-backed peek panel that resolves definitions correctly and adds hover + find-references for Python (ty), TypeScript (typescript-language-server), and Rust (rust-analyzer), falling back to ripgrep for other languages.

**Architecture:** A new `server/lsp/` module spawns one LSP per (project path, language) lazily, owned by the `Session`. Four new HTTP endpoints (`/definition`, `/hover`, `/references`, `/lsp/debug`) wrap LSP requests, with `/definition` falling back to `findSymbol()` on any LSP unavailability. Frontend `PeekPanel` gains a hover header and an inline references list; `DiffLine` passes the UTF-16 character offset under the click. A per-language `lspStatus` signal drives a header status badge.

**Tech Stack:** Node (NodeNext ESM), TypeScript, Express, `vscode-languageserver-protocol`, `vscode-jsonrpc`, SolidJS, Vitest + Supertest.

**Execution note:** This plan is long because the feature spans server-side infrastructure, HTTP endpoints, frontend integration, and three languages. It's phased internally so individual phases can ship and be used before the next one lands. Phases 1–3 deliver a working backend that can be tested via curl. Phase 4 wires it into the UI. Phase 5 adds the opt-in integration tests that validate against real LSP binaries.

---

## File Structure

### New files (backend)

| File | Responsibility |
|---|---|
| `server/lsp/uri.ts` | `pathToFileURL` / `fileURLToPath` helpers, symlink canonicalization |
| `server/lsp/languages.ts` | `extensionToLanguage()`, per-language command/args/init-options |
| `server/lsp/types.ts` | Local result shapes (Definition, Hover, Reference, Diagnostic) and `Language` type |
| `server/lsp/client.ts` | `LspClient` — one spawned LSP, JSON-RPC transport, lifecycle, per-method calls |
| `server/lsp/manager.ts` | `LspManager` — lazy per-language client creation, Session-scoped |
| `server/lsp/index.ts` | Re-exports public surface |
| `server/__tests__/lsp/uri.test.ts` | Unit tests for URI helpers |
| `server/__tests__/lsp/languages.test.ts` | Unit tests for language mapping and init-options |
| `server/__tests__/lsp/client.test.ts` | Unit tests for LspClient (transport stubbed) |
| `server/__tests__/lsp/manager.test.ts` | Unit tests for LspManager |
| `server/__tests__/routes-lsp.test.ts` | Route integration tests with stubbed manager |
| `server/__tests__/lsp/integration-ty.test.ts` | Real-ty E2E test, opt-in |
| `server/__tests__/lsp/integration-tsserver.test.ts` | Real typescript-language-server E2E, opt-in |
| `server/__tests__/lsp/integration-rust.test.ts` | Real rust-analyzer E2E, opt-in |
| `server/__tests__/fixtures/lsp/python/` | Python fixture repo (3 files + cross-file reference) |
| `server/__tests__/fixtures/lsp/typescript/` | TypeScript fixture repo |
| `server/__tests__/fixtures/lsp/rust/` | Rust fixture repo (Cargo project) |

### Modified files (backend)

| File | Change |
|---|---|
| `package.json` | Add `vscode-languageserver-protocol` and `vscode-jsonrpc` deps |
| `server/session.ts` | Add `lsp: LspManager` field, instantiate in constructor, expose getter, call `shutdown()` in a new `destroy()` method |
| `server/session-manager.ts` | Call `session.destroy()` in `deregister()` and in a new `shutdownAll()` method |
| `server/app.ts` | Add `/definition`, `/hover`, `/references`, `/lsp/debug`, `DELETE /lsp/request/:id` routes |
| `server/server.ts` | Call `manager.shutdownAll()` on `SIGINT`/`SIGTERM` |

### New files (frontend)

| File | Responsibility |
|---|---|
| `frontend/src/components/header/LspStatusBadge.tsx` | Renders per-language LSP status pill in the header when non-ok |
| `frontend/src/__tests__/lsp-character-offset.test.ts` | Unit tests for character-offset computation |
| `frontend/src/__tests__/PeekPanel.test.tsx` | Component tests for hover fields + references list |
| `frontend/src/__tests__/LspStatusBadge.test.tsx` | Component tests for badge states |

### Modified files (frontend)

| File | Change |
|---|---|
| `frontend/src/state.ts` | Add `Language` type, `lspStatus` store, `PeekState.character` field |
| `frontend/src/api.ts` | Add `fetchDefinition`, `fetchHover`, `fetchReferences`, `cancelLspRequest`; update `SymbolResult` to include hover/refs payloads; route `fetchSymbol` to name-search only |
| `frontend/src/components/diff/DiffLine.tsx` | Capture UTF-16 character offset in `getWordAtClick`; pass to `setPeekState` |
| `frontend/src/components/diff/PeekPanel.tsx` | Call `fetchDefinition` (new endpoint), parallel `fetchHover` and `fetchReferences`; render hover fields + refs list; cancel in-flight on close/supersede |
| `frontend/src/components/header/Header.tsx` (or wherever the app header is) | Mount `<LspStatusBadge />` |
| `frontend/src/style.css` | Styles for hover fields, references list, status badge |

---

## Phase 1: LSP infrastructure (Tasks 1–10)

### Task 1: Add dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add deps**

Run:

```bash
npm install --save vscode-languageserver-protocol@^3.17.5 vscode-jsonrpc@^8.2.1
```

- [ ] **Step 2: Verify install**

Run: `node -e "require('vscode-jsonrpc'); require('vscode-languageserver-protocol'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(server): add vscode-languageserver-protocol + vscode-jsonrpc"
```

---

### Task 2: URI helpers

**Files:**
- Create: `server/lsp/uri.ts`
- Test: `server/__tests__/lsp/uri.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/lsp/uri.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toFileUri, fromFileUri, realPath } from '../../lsp/uri.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('toFileUri / fromFileUri', () => {
  it('round-trips a plain absolute path', () => {
    const p = '/tmp/foo/bar.ts';
    const uri = toFileUri(p);
    expect(uri.startsWith('file://')).toBe(true);
    expect(fromFileUri(uri)).toBe(p);
  });

  it('handles spaces and unicode', () => {
    const p = '/tmp/path with spaces/файл.py';
    expect(fromFileUri(toFileUri(p))).toBe(p);
  });
});

describe('realPath', () => {
  it('resolves symlinks', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-uri-'));
    const real = path.join(dir, 'real.txt');
    const link = path.join(dir, 'link.txt');
    fs.writeFileSync(real, '');
    fs.symlinkSync(real, link);
    expect(realPath(link)).toBe(fs.realpathSync(real));
    fs.rmSync(dir, { recursive: true });
  });

  it('returns input when file does not exist', () => {
    expect(realPath('/does/not/exist')).toBe('/does/not/exist');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/__tests__/lsp/uri.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

Create `server/lsp/uri.ts`:

```ts
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as fs from 'node:fs';

export function toFileUri(absPath: string): string {
  return pathToFileURL(absPath).href;
}

export function fromFileUri(uri: string): string {
  return fileURLToPath(uri);
}

export function realPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/lsp/uri.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lsp/uri.ts server/__tests__/lsp/uri.test.ts
git commit -m "feat(server/lsp): URI helpers with symlink resolution"
```

---

### Task 3: Local types

**Files:**
- Create: `server/lsp/types.ts`

- [ ] **Step 1: Create the types file**

Create `server/lsp/types.ts`:

```ts
export type Language = 'python' | 'typescript' | 'rust';

export type LspStatus =
  | 'ok'
  | 'indexing'
  | 'missing'
  | 'crashed'
  | 'partial';

export interface LspPosition {
  line: number;      // 0-based
  character: number; // UTF-16 code units
}

export interface LspLocation {
  uri: string;
  range: {
    start: LspPosition;
    end: LspPosition;
  };
}

export interface DefinitionResult {
  locations: LspLocation[];
}

export interface HoverResult {
  signature?: string;
  type?: string;
  docs?: string;
}

export interface ReferenceResult {
  file: string;
  line: number;    // 1-based
  snippet: string;
}

export interface Diagnostic {
  line: number;         // 0-based
  character: number;
  endLine: number;
  endCharacter: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
}

export type LspRequestStatus =
  | 'ok'
  | 'indexing'
  | 'fallback'
  | 'partial'
  | 'missing';

export class LspTimeoutError extends Error {
  constructor(method: string, ms: number) {
    super(`LSP request ${method} timed out after ${ms}ms`);
    this.name = 'LspTimeoutError';
  }
}

export class LspShuttingDownError extends Error {
  constructor() {
    super('LSP client is shutting down');
    this.name = 'LspShuttingDownError';
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p server/tsconfig.json --noEmit`
Expected: no errors (the new file imports nothing yet)

- [ ] **Step 3: Commit**

```bash
git add server/lsp/types.ts
git commit -m "feat(server/lsp): local result and error types"
```

---

### Task 4: Language configuration

**Files:**
- Create: `server/lsp/languages.ts`
- Test: `server/__tests__/lsp/languages.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/lsp/languages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extensionToLanguage, getLanguageConfig } from '../../lsp/languages.js';

describe('extensionToLanguage', () => {
  it('maps Python files', () => {
    expect(extensionToLanguage('foo.py')).toBe('python');
  });

  it('maps TypeScript files', () => {
    expect(extensionToLanguage('foo.ts')).toBe('typescript');
    expect(extensionToLanguage('foo.tsx')).toBe('typescript');
    expect(extensionToLanguage('foo.js')).toBe('typescript');
    expect(extensionToLanguage('foo.jsx')).toBe('typescript');
  });

  it('maps Rust files', () => {
    expect(extensionToLanguage('foo.rs')).toBe('rust');
  });

  it('returns null for unsupported extensions', () => {
    expect(extensionToLanguage('foo.md')).toBe(null);
    expect(extensionToLanguage('foo')).toBe(null);
    expect(extensionToLanguage('foo.go')).toBe(null);
  });
});

describe('getLanguageConfig', () => {
  it('python config uses ty with LSP args', () => {
    const cfg = getLanguageConfig('python');
    expect(cfg.command).toBe('ty');
    expect(cfg.args).toContain('server');
    expect(cfg.initializeTimeoutMs).toBe(10_000);
  });

  it('typescript config uses typescript-language-server with stdio', () => {
    const cfg = getLanguageConfig('typescript');
    expect(cfg.command).toBe('typescript-language-server');
    expect(cfg.args).toContain('--stdio');
    expect(cfg.initializeTimeoutMs).toBe(15_000);
  });

  it('rust config uses rust-analyzer with serverStatus capability + per-worktree targetDir', () => {
    const cfg = getLanguageConfig('rust');
    expect(cfg.command).toBe('rust-analyzer');
    expect(cfg.experimentalCapabilities).toEqual({ serverStatusNotification: true });
    expect(cfg.initializationOptions).toMatchObject({ check: { targetDir: true } });
    expect(cfg.initializeTimeoutMs).toBe(180_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/lsp/languages.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

Create `server/lsp/languages.ts`:

```ts
import type { Language } from './types.js';

export interface LanguageConfig {
  command: string;
  args: string[];
  initializeTimeoutMs: number;
  initializationOptions?: Record<string, unknown>;
  experimentalCapabilities?: Record<string, unknown>;
  /** Whether this language requires `textDocument/didOpen` before requests resolve. */
  requiresOpen: boolean;
  /** For rust-analyzer: wait for experimental/serverStatus quiescent before ready. */
  waitForServerStatus?: boolean;
}

export function extensionToLanguage(filename: string): Language | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'typescript';
  if (lower.endsWith('.rs')) return 'rust';
  return null;
}

const CONFIGS: Record<Language, LanguageConfig> = {
  python: {
    command: 'ty',
    args: ['server'],
    initializeTimeoutMs: 10_000,
    requiresOpen: true,
  },
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    initializeTimeoutMs: 15_000,
    requiresOpen: true,
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
    initializeTimeoutMs: 180_000,
    experimentalCapabilities: { serverStatusNotification: true },
    initializationOptions: { check: { targetDir: true } },
    requiresOpen: true,
    waitForServerStatus: true,
  },
};

export function getLanguageConfig(language: Language): LanguageConfig {
  return CONFIGS[language];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/lsp/languages.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lsp/languages.ts server/__tests__/lsp/languages.test.ts
git commit -m "feat(server/lsp): language detection and per-language config"
```

---

### Task 5: LspClient skeleton (spawn, initialize, shutdown)

**Files:**
- Create: `server/lsp/client.ts`
- Test: `server/__tests__/lsp/client.test.ts`

The `LspClient` wraps `child_process.spawn()` with a `vscode-jsonrpc` message connection. We test the framing behavior and lifecycle without actually spawning an LSP by injecting a fake connection into the constructor.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/lsp/client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { LspClient } from '../../lsp/client.js';
import type { MessageConnection } from 'vscode-jsonrpc/node.js';

function makeFakeConnection(overrides: Partial<MessageConnection> = {}): MessageConnection {
  const handlers = new Map<string, (params: unknown) => void>();
  const listen = vi.fn();
  const sendRequest = vi.fn(async (method: string) => {
    if (method === 'initialize') {
      return { capabilities: {} };
    }
    return null;
  });
  const sendNotification = vi.fn();
  const onNotification = vi.fn((method: string, handler: (params: unknown) => void) => {
    handlers.set(method, handler);
    return { dispose: () => handlers.delete(method) };
  });
  const dispose = vi.fn();
  const onClose = vi.fn();
  return {
    listen,
    sendRequest,
    sendNotification,
    onNotification,
    dispose,
    onClose,
    ...overrides,
  } as unknown as MessageConnection;
}

describe('LspClient', () => {
  it('sends initialize + initialized, transitions to ready (non-rust)', async () => {
    const conn = makeFakeConnection();
    const client = new LspClient({
      language: 'python',
      projectPath: '/tmp/proj',
      connection: conn,
      stderrLines: 10,
    });
    await client.initialize();
    expect((conn.sendRequest as any).mock.calls[0][0]).toBe('initialize');
    expect((conn.sendNotification as any).mock.calls[0][0]).toBe('initialized');
    expect(client.state).toBe('ready');
  });

  it('shutdown sends shutdown + exit and disposes', async () => {
    const conn = makeFakeConnection();
    const client = new LspClient({
      language: 'python',
      projectPath: '/tmp/proj',
      connection: conn,
      stderrLines: 10,
    });
    await client.initialize();
    await client.shutdown();
    const methods = (conn.sendRequest as any).mock.calls.map((c: any[]) => c[0]);
    expect(methods).toContain('shutdown');
    const notifs = (conn.sendNotification as any).mock.calls.map((c: any[]) => c[0]);
    expect(notifs).toContain('exit');
    expect(client.state).toBe('shuttingDown');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/__tests__/lsp/client.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the skeleton**

Create `server/lsp/client.ts`:

```ts
import type { MessageConnection } from 'vscode-jsonrpc/node.js';
import { getLanguageConfig } from './languages.js';
import { toFileUri } from './uri.js';
import type { Language } from './types.js';

type ClientState = 'initializing' | 'indexing' | 'ready' | 'crashed' | 'shuttingDown';

interface LspClientOptions {
  language: Language;
  projectPath: string;
  connection: MessageConnection;
  stderrLines?: number;
}

export class LspClient {
  readonly language: Language;
  readonly projectPath: string;
  readonly stderrRing: string[] = [];
  private readonly _connection: MessageConnection;
  private readonly _stderrCap: number;
  private _state: ClientState = 'initializing';
  private _capabilities: Record<string, unknown> = {};

  constructor(opts: LspClientOptions) {
    this.language = opts.language;
    this.projectPath = opts.projectPath;
    this._connection = opts.connection;
    this._stderrCap = opts.stderrLines ?? 100;
  }

  get state(): ClientState {
    return this._state;
  }

  get capabilities(): Record<string, unknown> {
    return this._capabilities;
  }

  async initialize(): Promise<void> {
    const cfg = getLanguageConfig(this.language);
    this._connection.listen();
    this._state = 'initializing';

    const initParams = {
      processId: process.pid,
      clientInfo: { name: 'claude-review' },
      rootUri: toFileUri(this.projectPath),
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        textDocument: {
          definition: { dynamicRegistration: false },
          hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
          references: { dynamicRegistration: false },
          synchronization: { dynamicRegistration: false, didSave: true },
        },
        experimental: cfg.experimentalCapabilities,
      },
      initializationOptions: cfg.initializationOptions,
      workspaceFolders: [{ uri: toFileUri(this.projectPath), name: 'project' }],
    };

    const result = await this._connection.sendRequest('initialize', initParams) as { capabilities?: Record<string, unknown> };
    this._capabilities = result.capabilities ?? {};
    this._connection.sendNotification('initialized', {});
    this._state = 'indexing';

    if (cfg.waitForServerStatus) {
      // Handled in Task 6 when we wire experimental/serverStatus
      this._state = 'indexing';
    } else {
      this._state = 'ready';
    }
  }

  async shutdown(): Promise<void> {
    if (this._state === 'shuttingDown' || this._state === 'crashed') return;
    this._state = 'shuttingDown';
    try {
      await this._connection.sendRequest('shutdown', null);
    } catch {
      /* server may have already exited */
    }
    try {
      this._connection.sendNotification('exit');
    } catch {
      /* ditto */
    }
    this._connection.dispose();
  }

  appendStderr(line: string): void {
    this.stderrRing.push(line);
    if (this.stderrRing.length > this._stderrCap) this.stderrRing.shift();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/lsp/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lsp/client.ts server/__tests__/lsp/client.test.ts
git commit -m "feat(server/lsp): LspClient skeleton with initialize + shutdown"
```

---

### Task 6: LspClient — rust-analyzer quiescent wait

**Files:**
- Modify: `server/lsp/client.ts`
- Modify: `server/__tests__/lsp/client.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `server/__tests__/lsp/client.test.ts`:

```ts
describe('LspClient rust-analyzer quiescent wait', () => {
  it('stays indexing until experimental/serverStatus quiescent arrives', async () => {
    let statusHandler: ((p: unknown) => void) | null = null;
    const conn = makeFakeConnection({
      onNotification: ((method: string, handler: (p: unknown) => void) => {
        if (method === 'experimental/serverStatus') statusHandler = handler;
        return { dispose: () => {} };
      }) as any,
    });
    const client = new LspClient({
      language: 'rust',
      projectPath: '/tmp/proj',
      connection: conn,
      stderrLines: 10,
    });
    const ready = client.waitReady(1000);
    await client.initialize();
    expect(client.state).toBe('indexing');
    statusHandler!({ quiescent: false, health: 'ok', message: 'Building' });
    expect(client.state).toBe('indexing');
    statusHandler!({ quiescent: true, health: 'ok', message: 'Done' });
    await ready;
    expect(client.state).toBe('ready');
  });

  it('non-rust language resolves waitReady immediately', async () => {
    const conn = makeFakeConnection();
    const client = new LspClient({
      language: 'python',
      projectPath: '/tmp/proj',
      connection: conn,
      stderrLines: 10,
    });
    await client.initialize();
    await client.waitReady(1000);
    expect(client.state).toBe('ready');
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run server/__tests__/lsp/client.test.ts`
Expected: FAIL (`waitReady` not defined; rust flow missing)

- [ ] **Step 3: Implement**

Modify `server/lsp/client.ts` — replace the body of the class with this updated version that registers the `experimental/serverStatus` handler and exposes `waitReady`:

```ts
import type { MessageConnection } from 'vscode-jsonrpc/node.js';
import { getLanguageConfig } from './languages.js';
import { toFileUri } from './uri.js';
import type { Language } from './types.js';

type ClientState = 'initializing' | 'indexing' | 'ready' | 'crashed' | 'shuttingDown';

interface LspClientOptions {
  language: Language;
  projectPath: string;
  connection: MessageConnection;
  stderrLines?: number;
}

export class LspClient {
  readonly language: Language;
  readonly projectPath: string;
  readonly stderrRing: string[] = [];
  private readonly _connection: MessageConnection;
  private readonly _stderrCap: number;
  private _state: ClientState = 'initializing';
  private _capabilities: Record<string, unknown> = {};
  private _readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  constructor(opts: LspClientOptions) {
    this.language = opts.language;
    this.projectPath = opts.projectPath;
    this._connection = opts.connection;
    this._stderrCap = opts.stderrLines ?? 100;

    this._connection.onNotification('experimental/serverStatus', (params: unknown) => {
      const p = params as { quiescent?: boolean; health?: string; message?: string };
      if (p.quiescent === true && this._state === 'indexing') {
        this._state = 'ready';
        const waiters = this._readyWaiters;
        this._readyWaiters = [];
        for (const w of waiters) w.resolve();
      }
    });
  }

  get state(): ClientState {
    return this._state;
  }

  get capabilities(): Record<string, unknown> {
    return this._capabilities;
  }

  async initialize(): Promise<void> {
    const cfg = getLanguageConfig(this.language);
    this._connection.listen();
    this._state = 'initializing';

    const initParams = {
      processId: process.pid,
      clientInfo: { name: 'claude-review' },
      rootUri: toFileUri(this.projectPath),
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        textDocument: {
          definition: { dynamicRegistration: false },
          hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
          references: { dynamicRegistration: false },
          synchronization: { dynamicRegistration: false, didSave: true },
        },
        experimental: cfg.experimentalCapabilities,
      },
      initializationOptions: cfg.initializationOptions,
      workspaceFolders: [{ uri: toFileUri(this.projectPath), name: 'project' }],
    };

    const result = await this._connection.sendRequest('initialize', initParams) as { capabilities?: Record<string, unknown> };
    this._capabilities = result.capabilities ?? {};
    this._connection.sendNotification('initialized', {});
    this._state = 'indexing';

    if (!cfg.waitForServerStatus) {
      this._state = 'ready';
    }
  }

  waitReady(timeoutMs: number): Promise<void> {
    if (this._state === 'ready') return Promise.resolve();
    if (this._state === 'crashed' || this._state === 'shuttingDown') {
      return Promise.reject(new Error(`LspClient is ${this._state}`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._readyWaiters.findIndex(w => w.resolve === resolve);
        if (idx >= 0) this._readyWaiters.splice(idx, 1);
        reject(new Error(`waitReady timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this._readyWaiters.push({
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  async shutdown(): Promise<void> {
    if (this._state === 'shuttingDown' || this._state === 'crashed') return;
    this._state = 'shuttingDown';
    const waiters = this._readyWaiters;
    this._readyWaiters = [];
    for (const w of waiters) w.reject(new Error('client shutting down'));
    try {
      await this._connection.sendRequest('shutdown', null);
    } catch { /* server may have already exited */ }
    try {
      this._connection.sendNotification('exit');
    } catch { /* ditto */ }
    this._connection.dispose();
  }

  appendStderr(line: string): void {
    this.stderrRing.push(line);
    if (this.stderrRing.length > this._stderrCap) this.stderrRing.shift();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/__tests__/lsp/client.test.ts`
Expected: PASS (all tests including the quiescent one)

- [ ] **Step 5: Commit**

```bash
git add server/lsp/client.ts server/__tests__/lsp/client.test.ts
git commit -m "feat(server/lsp): wait for rust-analyzer experimental/serverStatus quiescent"
```

---

### Task 7: LspClient — definition / hover / references methods

**Files:**
- Modify: `server/lsp/client.ts`
- Modify: `server/__tests__/lsp/client.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `server/__tests__/lsp/client.test.ts`:

```ts
describe('LspClient request methods', () => {
  it('definition sends textDocument/definition with uri + position', async () => {
    const conn = makeFakeConnection({
      sendRequest: vi.fn(async (method: string, params?: unknown) => {
        if (method === 'initialize') return { capabilities: {} };
        if (method === 'textDocument/definition') {
          expect(params).toMatchObject({
            textDocument: { uri: expect.stringContaining('/tmp/proj/foo.py') },
            position: { line: 10, character: 4 },
          });
          return [{ uri: 'file:///tmp/proj/bar.py', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } } }];
        }
        return null;
      }) as any,
    });
    const client = new LspClient({ language: 'python', projectPath: '/tmp/proj', connection: conn });
    await client.initialize();
    const locs = await client.definition('/tmp/proj/foo.py', { line: 10, character: 4 });
    expect(locs).toHaveLength(1);
    expect(locs[0].uri).toContain('bar.py');
  });

  it('hover returns markdown-string contents', async () => {
    const conn = makeFakeConnection({
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'initialize') return { capabilities: {} };
        if (method === 'textDocument/hover') return { contents: { kind: 'markdown', value: '```py\ndef foo(x: int) -> str\n```' } };
        return null;
      }) as any,
    });
    const client = new LspClient({ language: 'python', projectPath: '/tmp/proj', connection: conn });
    await client.initialize();
    const hover = await client.hover('/tmp/proj/foo.py', { line: 0, character: 0 });
    expect(hover).toContain('def foo');
  });

  it('references returns array of Locations', async () => {
    const conn = makeFakeConnection({
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'initialize') return { capabilities: {} };
        if (method === 'textDocument/references') return [
          { uri: 'file:///tmp/proj/a.py', range: { start: { line: 5, character: 0 }, end: { line: 5, character: 3 } } },
          { uri: 'file:///tmp/proj/b.py', range: { start: { line: 9, character: 2 }, end: { line: 9, character: 5 } } },
        ];
        return null;
      }) as any,
    });
    const client = new LspClient({ language: 'python', projectPath: '/tmp/proj', connection: conn });
    await client.initialize();
    const refs = await client.references('/tmp/proj/a.py', { line: 0, character: 0 });
    expect(refs).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `npx vitest run server/__tests__/lsp/client.test.ts`
Expected: FAIL (methods not defined)

- [ ] **Step 3: Add methods to `LspClient`**

Append inside the `LspClient` class body in `server/lsp/client.ts` (before `shutdown`):

```ts
  async definition(filePath: string, pos: { line: number; character: number }): Promise<Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>> {
    const uri = toFileUri(filePath);
    const result = await this._connection.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position: pos,
    });
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  }

  async hover(filePath: string, pos: { line: number; character: number }): Promise<string | null> {
    const uri = toFileUri(filePath);
    const result = await this._connection.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position: pos,
    }) as { contents?: { kind?: string; value?: string } | string | Array<{ value?: string } | string> } | null;
    if (!result || !result.contents) return null;
    const c = result.contents;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(x => typeof x === 'string' ? x : (x.value ?? '')).join('\n');
    return c.value ?? null;
  }

  async references(filePath: string, pos: { line: number; character: number }): Promise<Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>> {
    const uri = toFileUri(filePath);
    const result = await this._connection.sendRequest('textDocument/references', {
      textDocument: { uri },
      position: pos,
      context: { includeDeclaration: false },
    });
    if (!result || !Array.isArray(result)) return [];
    return result;
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/__tests__/lsp/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lsp/client.ts server/__tests__/lsp/client.test.ts
git commit -m "feat(server/lsp): definition/hover/references methods"
```

---

### Task 8: LspClient — openFile / closeFile

**Files:**
- Modify: `server/lsp/client.ts`
- Modify: `server/__tests__/lsp/client.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `server/__tests__/lsp/client.test.ts`:

```ts
describe('LspClient openFile / closeFile', () => {
  it('openFile sends didOpen with file content', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-client-open-'));
    const file = path.join(tmp, 'x.py');
    fs.writeFileSync(file, 'print(1)\n');
    const conn = makeFakeConnection();
    const client = new LspClient({ language: 'python', projectPath: tmp, connection: conn });
    await client.initialize();
    await client.openFile(file);
    const call = (conn.sendNotification as any).mock.calls.find((c: any[]) => c[0] === 'textDocument/didOpen');
    expect(call).toBeTruthy();
    expect(call[1].textDocument.text).toBe('print(1)\n');
    expect(client.isOpen(file)).toBe(true);
    fs.rmSync(tmp, { recursive: true });
  });

  it('closeFile sends didClose and drops from open set', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-client-close-'));
    const file = path.join(tmp, 'x.py');
    fs.writeFileSync(file, 'y = 2\n');
    const conn = makeFakeConnection();
    const client = new LspClient({ language: 'python', projectPath: tmp, connection: conn });
    await client.initialize();
    await client.openFile(file);
    await client.closeFile(file);
    const call = (conn.sendNotification as any).mock.calls.find((c: any[]) => c[0] === 'textDocument/didClose');
    expect(call).toBeTruthy();
    expect(client.isOpen(file)).toBe(false);
    fs.rmSync(tmp, { recursive: true });
  });

  it('openFile is idempotent', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-client-idem-'));
    const file = path.join(tmp, 'x.py');
    fs.writeFileSync(file, '');
    const conn = makeFakeConnection();
    const client = new LspClient({ language: 'python', projectPath: tmp, connection: conn });
    await client.initialize();
    await client.openFile(file);
    await client.openFile(file);
    const opens = (conn.sendNotification as any).mock.calls.filter((c: any[]) => c[0] === 'textDocument/didOpen');
    expect(opens).toHaveLength(1);
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('LspClient crash marking', () => {
  it('markCrashed flips state to crashed and rejects ready waiters', async () => {
    const conn = makeFakeConnection();
    const client = new LspClient({ language: 'rust', projectPath: '/tmp/proj', connection: conn });
    const ready = client.waitReady(1000);
    await client.initialize();
    expect(client.state).toBe('indexing');
    client.markCrashed('exit code 101');
    await expect(ready).rejects.toThrow(/crashed/);
    expect(client.state).toBe('crashed');
  });
});
```

Also add to the imports at the top of that test file:

```ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run server/__tests__/lsp/client.test.ts`
Expected: FAIL (methods not defined)

- [ ] **Step 3: Add `openFile` / `closeFile` / `isOpen` to `LspClient`**

Add a private field and methods to `server/lsp/client.ts`. Add this import at the top:

```ts
import * as fs from 'node:fs';
```

Add this field next to the other private fields:

```ts
  private readonly _openFiles = new Set<string>();
```

And add these methods inside the class (before `shutdown`):

```ts
  async openFile(filePath: string): Promise<void> {
    if (this._openFiles.has(filePath)) return;
    const text = fs.readFileSync(filePath, 'utf8');
    const uri = toFileUri(filePath);
    this._connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: this.language,
        version: 1,
        text,
      },
    });
    this._openFiles.add(filePath);
  }

  async closeFile(filePath: string): Promise<void> {
    if (!this._openFiles.has(filePath)) return;
    const uri = toFileUri(filePath);
    this._connection.sendNotification('textDocument/didClose', {
      textDocument: { uri },
    });
    this._openFiles.delete(filePath);
  }

  isOpen(filePath: string): boolean {
    return this._openFiles.has(filePath);
  }

  openFiles(): string[] {
    return Array.from(this._openFiles);
  }
```

Also add a child-process reference (for SIGTERM/SIGKILL escalation during shutdown) and a `markCrashed` method. Add to imports at the top:

```ts
import type { ChildProcess } from 'node:child_process';
```

Add a private field to the class:

```ts
  private _child: ChildProcess | null = null;
```

Add these two methods inside the class (anywhere before `shutdown`):

```ts
  attachChild(child: ChildProcess): void {
    this._child = child;
  }

  markCrashed(reason: string): void {
    if (this._state === 'shuttingDown' || this._state === 'crashed') return;
    this._state = 'crashed';
    this.appendStderr(`[client] crashed: ${reason}`);
    const waiters = this._readyWaiters;
    this._readyWaiters = [];
    for (const w of waiters) w.reject(new Error(`LSP crashed: ${reason}`));
  }
```

Update the `shutdown` method to close open files, then request graceful shutdown, then escalate with SIGTERM/SIGKILL if the child hasn't exited:

```ts
  async shutdown(): Promise<void> {
    if (this._state === 'shuttingDown' || this._state === 'crashed') return;
    this._state = 'shuttingDown';
    for (const f of Array.from(this._openFiles)) {
      try { await this.closeFile(f); } catch { /* ignore */ }
    }
    const waiters = this._readyWaiters;
    this._readyWaiters = [];
    for (const w of waiters) w.reject(new Error('client shutting down'));
    try { await this._connection.sendRequest('shutdown', null); } catch { /* ignored */ }
    try { this._connection.sendNotification('exit'); } catch { /* ignored */ }
    this._connection.dispose();

    const child = this._child;
    if (!child || child.killed || child.exitCode != null) return;

    const waitExit = (ms: number) => new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      child.once('exit', () => { clearTimeout(timer); resolve(true); });
    });

    if (await waitExit(2000)) return;
    child.kill('SIGTERM');
    if (await waitExit(3000)) return;
    child.kill('SIGKILL');
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/__tests__/lsp/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lsp/client.ts server/__tests__/lsp/client.test.ts
git commit -m "feat(server/lsp): openFile/closeFile with idempotent tracking"
```

---

### Task 9: LspClient — request cancellation + timeouts + dedup

**Files:**
- Modify: `server/lsp/client.ts`
- Modify: `server/__tests__/lsp/client.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `server/__tests__/lsp/client.test.ts`:

```ts
describe('LspClient request lifecycle', () => {
  it('timeout rejects with LspTimeoutError', async () => {
    const conn = makeFakeConnection({
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'initialize') return { capabilities: {} };
        return new Promise(() => {}); // hangs forever
      }) as any,
    });
    const client = new LspClient({ language: 'python', projectPath: '/tmp/proj', connection: conn, requestTimeoutMs: 50 });
    await client.initialize();
    await expect(client.definition('/tmp/proj/foo.py', { line: 0, character: 0 }))
      .rejects.toThrow(/timed out/);
  });

  it('dedups concurrent identical requests into one in-flight promise', async () => {
    const send = vi.fn(async (method: string) => {
      if (method === 'initialize') return { capabilities: {} };
      await new Promise(r => setTimeout(r, 20));
      return [];
    });
    const conn = makeFakeConnection({ sendRequest: send as any });
    const client = new LspClient({ language: 'python', projectPath: '/tmp/proj', connection: conn });
    await client.initialize();
    const [a, b] = await Promise.all([
      client.definition('/tmp/proj/foo.py', { line: 0, character: 0 }),
      client.definition('/tmp/proj/foo.py', { line: 0, character: 0 }),
    ]);
    expect(a).toBe(b);
    const defCalls = send.mock.calls.filter((c: any[]) => c[0] === 'textDocument/definition');
    expect(defCalls).toHaveLength(1);
  });

  it('shutting-down state rejects new requests immediately', async () => {
    const conn = makeFakeConnection();
    const client = new LspClient({ language: 'python', projectPath: '/tmp/proj', connection: conn });
    await client.initialize();
    const shutdownPromise = client.shutdown();
    await expect(client.definition('/tmp/proj/foo.py', { line: 0, character: 0 }))
      .rejects.toThrow(/shutting down/);
    await shutdownPromise;
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run server/__tests__/lsp/client.test.ts`
Expected: FAIL (no timeout, no dedup, no shutting-down guard)

- [ ] **Step 3: Implement**

Update `server/lsp/client.ts`:

Add `LspTimeoutError`, `LspShuttingDownError` to imports:

```ts
import { LspTimeoutError, LspShuttingDownError } from './types.js';
```

Add `requestTimeoutMs` to options and inflight map to the class:

```ts
interface LspClientOptions {
  language: Language;
  projectPath: string;
  connection: MessageConnection;
  stderrLines?: number;
  requestTimeoutMs?: number;
}
```

And inside the class:

```ts
  private readonly _requestTimeoutMs: number;
  private readonly _inflight = new Map<string, Promise<unknown>>();
```

Initialize `_requestTimeoutMs` in the constructor: `this._requestTimeoutMs = opts.requestTimeoutMs ?? 5000;`

Replace the three request methods with this helper-backed pattern. Add the helper:

```ts
  private async _request<T>(method: string, params: unknown, dedupKey: string): Promise<T> {
    if (this._state === 'shuttingDown') throw new LspShuttingDownError();

    const existing = this._inflight.get(dedupKey);
    if (existing) return existing as Promise<T>;

    const promise = (async () => {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new LspTimeoutError(method, this._requestTimeoutMs)), this._requestTimeoutMs),
      );
      try {
        return await Promise.race([
          this._connection.sendRequest(method, params) as Promise<T>,
          timeoutPromise,
        ]);
      } finally {
        this._inflight.delete(dedupKey);
      }
    })();

    this._inflight.set(dedupKey, promise);
    return promise;
  }
```

And rewrite `definition` / `hover` / `references` to call it:

```ts
  async definition(filePath: string, pos: { line: number; character: number }) {
    const uri = toFileUri(filePath);
    const key = `definition:${filePath}:${pos.line}:${pos.character}`;
    const result = await this._request<unknown>(
      'textDocument/definition',
      { textDocument: { uri }, position: pos },
      key,
    );
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  }

  async hover(filePath: string, pos: { line: number; character: number }): Promise<string | null> {
    const uri = toFileUri(filePath);
    const key = `hover:${filePath}:${pos.line}:${pos.character}`;
    const result = await this._request<{ contents?: unknown } | null>(
      'textDocument/hover',
      { textDocument: { uri }, position: pos },
      key,
    );
    if (!result || !result.contents) return null;
    const c = result.contents as any;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((x: any) => typeof x === 'string' ? x : (x.value ?? '')).join('\n');
    return c.value ?? null;
  }

  async references(filePath: string, pos: { line: number; character: number }) {
    const uri = toFileUri(filePath);
    const key = `references:${filePath}:${pos.line}:${pos.character}`;
    const result = await this._request<unknown>(
      'textDocument/references',
      { textDocument: { uri }, position: pos, context: { includeDeclaration: false } },
      key,
    );
    if (!result || !Array.isArray(result)) return [];
    return result as Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>;
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/__tests__/lsp/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lsp/client.ts server/__tests__/lsp/client.test.ts
git commit -m "feat(server/lsp): request timeouts + dedup + shutdown guard"
```

---

### Task 10: LspClient — `cancel` method (LSP $/cancelRequest)

**Files:**
- Modify: `server/lsp/client.ts`
- Modify: `server/__tests__/lsp/client.test.ts`

`vscode-jsonrpc` cancels requests by aborting a `CancellationToken` passed to `sendRequest`. We expose an `AbortController`-shaped interface at our boundary and map it to a `CancellationTokenSource` internally.

- [ ] **Step 1: Add the failing test**

Append to `server/__tests__/lsp/client.test.ts`:

```ts
describe('LspClient request cancellation', () => {
  it('cancelling an in-flight request rejects it and sends $/cancelRequest', async () => {
    let cancelled = false;
    const conn = makeFakeConnection({
      sendRequest: vi.fn(async (method: string, _params?: unknown, token?: any) => {
        if (method === 'initialize') return { capabilities: {} };
        return new Promise((_resolve, reject) => {
          token?.onCancellationRequested?.(() => { cancelled = true; reject(new Error('cancelled')); });
        });
      }) as any,
    });
    const client = new LspClient({ language: 'python', projectPath: '/tmp/proj', connection: conn });
    await client.initialize();
    const p = client.definition('/tmp/proj/foo.py', { line: 0, character: 0 });
    client.cancel('definition', '/tmp/proj/foo.py', { line: 0, character: 0 });
    await expect(p).rejects.toThrow(/cancelled/);
    expect(cancelled).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run server/__tests__/lsp/client.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement cancellation**

Update `server/lsp/client.ts`. Add to imports:

```ts
import { CancellationTokenSource } from 'vscode-jsonrpc/node.js';
```

Replace the `_inflight` map's value type to track the source alongside the promise:

```ts
  private readonly _inflight = new Map<string, { promise: Promise<unknown>; source: CancellationTokenSource }>();
```

Update `_request` to pass the token through:

```ts
  private async _request<T>(method: string, params: unknown, dedupKey: string): Promise<T> {
    if (this._state === 'shuttingDown') throw new LspShuttingDownError();

    const existing = this._inflight.get(dedupKey);
    if (existing) return existing.promise as Promise<T>;

    const source = new CancellationTokenSource();
    const promise = (async () => {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new LspTimeoutError(method, this._requestTimeoutMs)), this._requestTimeoutMs),
      );
      try {
        return await Promise.race([
          this._connection.sendRequest(method, params, source.token) as Promise<T>,
          timeoutPromise,
        ]);
      } finally {
        this._inflight.delete(dedupKey);
        source.dispose();
      }
    })();

    this._inflight.set(dedupKey, { promise, source });
    return promise;
  }
```

And add the public `cancel` method:

```ts
  cancel(method: 'definition' | 'hover' | 'references', filePath: string, pos: { line: number; character: number }): void {
    const key = `${method}:${filePath}:${pos.line}:${pos.character}`;
    const entry = this._inflight.get(key);
    if (entry) entry.source.cancel();
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/__tests__/lsp/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lsp/client.ts server/__tests__/lsp/client.test.ts
git commit -m "feat(server/lsp): cancel in-flight requests with $/cancelRequest"
```

---

## Phase 2: LspManager + Session integration (Tasks 11–12)

### Task 11: LspManager

**Files:**
- Create: `server/lsp/manager.ts`
- Create: `server/lsp/index.ts`
- Test: `server/__tests__/lsp/manager.test.ts`

The manager owns one LspClient per language for a Session. A production `spawn()` path creates a real child process and wires its stdio to a `vscode-jsonrpc` connection. Tests use an injected factory so no child is actually spawned.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/lsp/manager.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { LspManager } from '../../lsp/manager.js';
import { LspClient } from '../../lsp/client.js';
import type { MessageConnection } from 'vscode-jsonrpc/node.js';

function makeFakeConnection(): MessageConnection {
  return {
    listen: vi.fn(),
    sendRequest: vi.fn(async () => ({ capabilities: {} })),
    sendNotification: vi.fn(),
    onNotification: vi.fn(() => ({ dispose: () => {} })),
    dispose: vi.fn(),
    onClose: vi.fn(),
  } as unknown as MessageConnection;
}

describe('LspManager', () => {
  it('lazy-spawns a client on first get()', async () => {
    const factory = vi.fn(async (language) => {
      const client = new LspClient({
        language, projectPath: '/tmp/proj', connection: makeFakeConnection(),
      });
      await client.initialize();
      return client;
    });
    const mgr = new LspManager({ projectPath: '/tmp/proj', clientFactory: factory });
    const c = await mgr.get('python');
    expect(c).toBeTruthy();
    expect(factory).toHaveBeenCalledTimes(1);
    const c2 = await mgr.get('python');
    expect(c2).toBe(c);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('returns null for a language whose binary is missing', async () => {
    const factory = vi.fn(async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    const mgr = new LspManager({ projectPath: '/tmp/proj', clientFactory: factory });
    const c = await mgr.get('python');
    expect(c).toBeNull();
    const c2 = await mgr.get('python');
    expect(c2).toBeNull();
    expect(factory).toHaveBeenCalledTimes(1); // cached null
  });

  it('status reflects per-language state', async () => {
    const factory = vi.fn(async (language) => {
      const client = new LspClient({
        language, projectPath: '/tmp/proj', connection: makeFakeConnection(),
      });
      await client.initialize();
      return client;
    });
    const mgr = new LspManager({ projectPath: '/tmp/proj', clientFactory: factory });
    expect(mgr.status('python')).toBe('missing'); // not attempted yet — treat as missing until proven otherwise
    await mgr.get('python');
    expect(mgr.status('python')).toBe('ok');
  });

  it('shutdown closes all clients', async () => {
    const clients: any[] = [];
    const factory = vi.fn(async (language) => {
      const c: any = new LspClient({ language, projectPath: '/tmp/proj', connection: makeFakeConnection() });
      c.shutdown = vi.fn(async () => {});
      await c.initialize();
      clients.push(c);
      return c;
    });
    const mgr = new LspManager({ projectPath: '/tmp/proj', clientFactory: factory });
    await mgr.get('python');
    await mgr.get('typescript');
    await mgr.shutdown();
    expect(clients[0].shutdown).toHaveBeenCalled();
    expect(clients[1].shutdown).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/lsp/manager.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `LspManager`**

Create `server/lsp/manager.ts`:

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import { LspClient } from './client.js';
import { getLanguageConfig } from './languages.js';
import type { Language, LspStatus } from './types.js';

type ClientFactory = (language: Language, projectPath: string) => Promise<LspClient>;

interface LspManagerOptions {
  projectPath: string;
  /** For tests; defaults to spawning real LSP binaries. */
  clientFactory?: ClientFactory;
}

/**
 * Default factory: spawn the language's LSP binary as a child process, wire its stdio to
 * a vscode-jsonrpc MessageConnection, construct an LspClient, and run initialize + waitReady.
 */
async function defaultClientFactory(language: Language, projectPath: string): Promise<LspClient> {
  const cfg = getLanguageConfig(language);
  let child: ChildProcess;
  try {
    child = spawn(cfg.command, cfg.args, {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    throw err;
  }
  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout!),
    new StreamMessageWriter(child.stdin!),
  );
  const client = new LspClient({ language, projectPath, connection });

  // If the binary itself is missing, spawn emits 'error' asynchronously.
  const errPromise = new Promise<never>((_, reject) => {
    child.once('error', (err) => reject(err));
  });

  child.stderr?.on('data', (buf: Buffer) => {
    for (const line of buf.toString('utf8').split('\n')) {
      if (line) client.appendStderr(line);
    }
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      client.markCrashed(`exit code ${code}`);
    }
  });

  // Track the child so shutdown can escalate if the server doesn't exit gracefully.
  client.attachChild(child);

  await Promise.race([client.initialize(), errPromise]);
  await Promise.race([client.waitReady(cfg.initializeTimeoutMs), errPromise]);
  return client;
}

export class LspManager {
  readonly projectPath: string;
  private readonly _factory: ClientFactory;
  private _clients = new Map<Language, LspClient>();
  private _known = new Map<Language, 'missing' | 'ok'>();
  private _shuttingDown = false;

  constructor(opts: LspManagerOptions) {
    this.projectPath = opts.projectPath;
    this._factory = opts.clientFactory ?? defaultClientFactory;
  }

  async get(language: Language): Promise<LspClient | null> {
    if (this._shuttingDown) return null;
    if (this._known.get(language) === 'missing') return null;

    const existing = this._clients.get(language);
    if (existing) return existing;

    try {
      const client = await this._factory(language, this.projectPath);
      this._clients.set(language, client);
      this._known.set(language, 'ok');
      return client;
    } catch (err: any) {
      if (err?.code === 'ENOENT' || /ENOENT/.test(err?.message ?? '')) {
        console.log(`LSP_MISSING language=${language} reason=ENOENT`);
        this._known.set(language, 'missing');
        return null;
      }
      throw err;
    }
  }

  status(language: Language): LspStatus {
    const known = this._known.get(language);
    if (known === 'missing') return 'missing';
    const client = this._clients.get(language);
    if (!client) return 'missing';
    const s = client.state;
    if (s === 'ready') return 'ok';
    if (s === 'indexing' || s === 'initializing') return 'indexing';
    if (s === 'crashed') return 'crashed';
    return 'missing';
  }

  async shutdown(): Promise<void> {
    this._shuttingDown = true;
    const promises: Promise<void>[] = [];
    for (const client of this._clients.values()) {
      promises.push(client.shutdown().catch(() => {}));
    }
    await Promise.all(promises);
    this._clients.clear();
  }
}
```

Also create `server/lsp/index.ts`:

```ts
export { LspClient } from './client.js';
export { LspManager } from './manager.js';
export { extensionToLanguage, getLanguageConfig } from './languages.js';
export { toFileUri, fromFileUri, realPath } from './uri.js';
export * from './types.js';
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/__tests__/lsp/manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lsp/manager.ts server/lsp/index.ts server/__tests__/lsp/manager.test.ts
git commit -m "feat(server/lsp): LspManager with lazy spawn + ENOENT caching"
```

---

### Task 12: Session integration

**Files:**
- Modify: `server/session.ts`
- Modify: `server/session-manager.ts`

- [ ] **Step 1: Add the `lsp` field to `Session`**

In `server/session.ts`, add import at the top:

```ts
import { LspManager } from './lsp/index.js';
```

Add the private field alongside the other private fields in the `Session` class:

```ts
  private _lsp: LspManager;
```

Initialize it in the constructor (after `this._slug = opts.slug ?? '';`):

```ts
    this._lsp = new LspManager({ projectPath: this.repoPath });
```

Add a getter and a `destroy()` method to the class:

```ts
  get lsp(): LspManager {
    return this._lsp;
  }

  async destroy(): Promise<void> {
    await this._lsp.shutdown();
  }
```

- [ ] **Step 2: Wire `destroy()` into deregister**

In `server/session-manager.ts`, update `deregister`:

```ts
  deregister(slug: string): boolean {
    const session = this._sessions.get(slug);
    if (session) {
      session.unwatchRepo();
      void session.destroy();
    }
    const removed = this._sessions.delete(slug);
    if (removed) storeDelete(slug);
    return removed;
  }
```

Also add a `shutdownAll()` method to the class (before the closing brace):

```ts
  async shutdownAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const session of this._sessions.values()) {
      session.unwatchRepo();
      promises.push(session.destroy().catch(() => {}));
    }
    await Promise.all(promises);
    this._sessions.clear();
  }
```

- [ ] **Step 3: Verify build**

Run: `npm run build:server`
Expected: no errors

- [ ] **Step 4: Run existing server tests to ensure nothing regressed**

Run: `npm run test:server`
Expected: all existing tests pass

- [ ] **Step 5: Commit**

```bash
git add server/session.ts server/session-manager.ts
git commit -m "feat(server): attach LspManager to Session, shutdown on deregister"
```

---

## Phase 3: HTTP endpoints (Tasks 13–17)

### Task 13: `/definition` endpoint with ripgrep fallback

**Files:**
- Modify: `server/app.ts`
- Create: `server/__tests__/routes-lsp.test.ts`

The endpoint maps to `LspClient.definition()`, translates LSP `Location`s into the existing `SymbolResult` shape by reusing body/docstring extraction from `symbol-lookup.ts`, and falls back to `findSymbol()` when the LSP is unavailable. Since `symbol-lookup.ts` currently embeds the extraction helpers as non-exported functions, this task first factors them out.

- [ ] **Step 1: Factor out extraction helpers in `server/symbol-lookup.ts`**

At the bottom of `server/symbol-lookup.ts`, change the declarations of `extractPythonBody`, `extractTypeScriptBody`, `extractPythonDocstring`, `extractJsDocstring`, and `detectKind` from non-exported to exported:

```ts
export function extractPythonBody(lines: string[], startIndex: number): string { /* existing body */ }
export function extractTypeScriptBody(lines: string[], startIndex: number): string { /* existing body */ }
export function extractPythonDocstring(lines: string[], startIndex: number): string | null { /* existing body */ }
export function extractJsDocstring(lines: string[], startIndex: number): string | null { /* existing body */ }
export function detectKind(lineText: string): SymbolResult['kind'] { /* existing body */ }
```

No behavior change — just surface them.

- [ ] **Step 2: Write the failing route test**

Create `server/__tests__/routes-lsp.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { createApp } from '../app.js';
import { SessionManager } from '../session-manager.js';

function makeRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-lsp-test-'));
  execSync('git init', { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  execSync('git add .', { cwd: dir });
  execSync('git -c user.name=t -c user.email=t@t commit -m init', { cwd: dir });
  return dir;
}

let repoDir: string;
let mgr: SessionManager;

afterEach(async () => {
  if (mgr) await mgr.shutdownAll();
  if (repoDir && fs.existsSync(repoDir)) fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('GET /project/:slug/definition', () => {
  it('falls back to findSymbol when LSP is missing', async () => {
    repoDir = makeRepo({
      'foo.py': 'def hello():\n    return 1\n',
    });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);

    // Stub LspManager.get to return null (missing)
    const session = mgr.get(slug)!;
    (session.lsp as any).get = vi.fn(async () => null);

    const app = createApp(mgr);
    const resp = await request(app)
      .get(`/project/${slug}/definition?file=foo.py&line=0&character=4`);
    expect(resp.status).toBe(200);
    expect(resp.body.status).toMatch(/fallback|missing/);
    expect(resp.body.result.results).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.server.ts server/__tests__/routes-lsp.test.ts`
Expected: FAIL (route not defined)

- [ ] **Step 4: Implement the route**

In `server/app.ts`, add imports at the top:

```ts
import { extensionToLanguage } from './lsp/index.js';
import { fromFileUri } from './lsp/uri.js';
import {
  extractPythonBody, extractTypeScriptBody, extractPythonDocstring, extractJsDocstring, detectKind,
  type SymbolResult,
} from './symbol-lookup.js';
```

After the existing `projectRouter.get('/symbol', ...)` block, add:

```ts
  projectRouter.get('/definition', async (req, res) => {
    const session = res.locals.session;
    const file = (req.query.file as string) ?? '';
    const line = parseInt((req.query.line as string) ?? '-1', 10);
    const character = parseInt((req.query.character as string) ?? '-1', 10);
    if (!file || line < 0 || character < 0) {
      res.status(400).json({ error: 'file, line, character required' });
      return;
    }
    const language = extensionToLanguage(file);
    const absPath = path.resolve(session.repoPath, file);

    const fallback = () => {
      // Use the word at (line, character) against findSymbol to match legacy behavior
      let name = '';
      try {
        const content = readFileSync(absPath, 'utf8');
        const lines = content.split('\n');
        const l = lines[line] ?? '';
        let s = character; let e = character;
        while (s > 0 && /[\w]/.test(l[s - 1])) s--;
        while (e < l.length && /[\w]/.test(l[e])) e++;
        name = l.slice(s, e);
      } catch { /* ignore */ }
      if (!name) return { symbol: '', results: [] as SymbolResult[] };
      const results = findSymbol(session.repoPath, name);
      return { symbol: name, results: sortResults(results, new Set([file])) };
    };

    if (!language) {
      res.json({ status: 'fallback', result: fallback() });
      return;
    }

    const client = await session.lsp.get(language);
    if (!client) {
      res.json({ status: 'missing', result: fallback() });
      return;
    }

    const cfg = (await import('./lsp/languages.js')).getLanguageConfig(language);
    if (cfg.requiresOpen) await client.openFile(absPath);

    try {
      const locs = await client.definition(absPath, { line, character });
      if (locs.length === 0) {
        res.json({ status: 'ok', result: { symbol: '', results: [] } });
        return;
      }
      const results: SymbolResult[] = [];
      for (const loc of locs) {
        const targetPath = fromFileUri(loc.uri);
        let content: string;
        try { content = readFileSync(targetPath, 'utf8'); } catch { continue; }
        const lines = content.split('\n');
        const startLine = loc.range.start.line;
        const lineText = lines[startLine] ?? '';
        const kind = detectKind(lineText);
        const body = targetPath.endsWith('.py')
          ? extractPythonBody(lines, startLine)
          : extractTypeScriptBody(lines, startLine);
        const docstring = targetPath.endsWith('.py')
          ? extractPythonDocstring(lines, startLine)
          : extractJsDocstring(lines, startLine);
        const relative = path.relative(session.repoPath, targetPath) || targetPath;
        results.push({ file: relative, line: startLine + 1, kind, body, docstring });
      }
      res.json({ status: 'ok', result: { symbol: '', results } });
    } catch (err) {
      console.log(`LSP_DEFINITION_FAIL language=${language} error=${(err as Error).message}`);
      res.json({ status: 'fallback', result: fallback() });
    }
  });
```

(Make sure `readFileSync` is imported — it already is at the top of the file.)

- [ ] **Step 5: Run tests**

Run: `npx vitest run --config vitest.config.server.ts server/__tests__/routes-lsp.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/app.ts server/symbol-lookup.ts server/__tests__/routes-lsp.test.ts
git commit -m "feat(server): GET /definition route with LSP + ripgrep fallback"
```

---

### Task 14: `/hover` endpoint

**Files:**
- Modify: `server/app.ts`
- Modify: `server/__tests__/routes-lsp.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `server/__tests__/routes-lsp.test.ts`:

```ts
describe('GET /project/:slug/hover', () => {
  it('returns hover content when LSP responds', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;
    const fakeClient = {
      hover: vi.fn(async () => '```py\nx: int\n```'),
      openFile: vi.fn(async () => {}),
    };
    (session.lsp as any).get = vi.fn(async () => fakeClient);

    const app = createApp(mgr);
    const resp = await request(app)
      .get(`/project/${slug}/hover?file=foo.py&line=0&character=0`);
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe('ok');
    expect(resp.body.result.signature).toContain('x: int');
  });

  it('returns empty result when LSP is missing', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;
    (session.lsp as any).get = vi.fn(async () => null);

    const app = createApp(mgr);
    const resp = await request(app)
      .get(`/project/${slug}/hover?file=foo.py&line=0&character=0`);
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe('missing');
    expect(resp.body.result).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.server.ts server/__tests__/routes-lsp.test.ts`
Expected: FAIL (route not defined)

- [ ] **Step 3: Implement**

In `server/app.ts`, add after the `/definition` route:

```ts
  projectRouter.get('/hover', async (req, res) => {
    const session = res.locals.session;
    const file = (req.query.file as string) ?? '';
    const line = parseInt((req.query.line as string) ?? '-1', 10);
    const character = parseInt((req.query.character as string) ?? '-1', 10);
    if (!file || line < 0 || character < 0) {
      res.status(400).json({ error: 'file, line, character required' });
      return;
    }
    const language = extensionToLanguage(file);
    if (!language) {
      res.json({ status: 'missing', result: {} });
      return;
    }
    const client = await session.lsp.get(language);
    if (!client) {
      res.json({ status: 'missing', result: {} });
      return;
    }
    const absPath = path.resolve(session.repoPath, file);
    const cfg = (await import('./lsp/languages.js')).getLanguageConfig(language);
    if (cfg.requiresOpen) await client.openFile(absPath);
    try {
      const raw = await client.hover(absPath, { line, character });
      if (!raw) {
        res.json({ status: 'ok', result: {} });
        return;
      }
      // Parse "```<lang>\n<signature>\n```\n\n<docs>" shape that most LSPs use
      const match = raw.match(/^```[^\n]*\n([\s\S]*?)\n```\s*(?:\n+([\s\S]*))?$/);
      const signature = match ? match[1].trim() : raw.trim();
      const docs = match?.[2]?.trim();
      res.json({ status: 'ok', result: { signature, docs } });
    } catch (err) {
      console.log(`LSP_HOVER_FAIL language=${language} error=${(err as Error).message}`);
      res.json({ status: 'fallback', result: {} });
    }
  });
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --config vitest.config.server.ts server/__tests__/routes-lsp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/__tests__/routes-lsp.test.ts
git commit -m "feat(server): GET /hover route"
```

---

### Task 15: `/references` endpoint

**Files:**
- Modify: `server/app.ts`
- Modify: `server/__tests__/routes-lsp.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `server/__tests__/routes-lsp.test.ts`:

```ts
describe('GET /project/:slug/references', () => {
  it('translates Locations into file/line/snippet triples', async () => {
    repoDir = makeRepo({
      'foo.py': 'def hello():\n    return 1\n',
      'bar.py': 'from foo import hello\nhello()\nhello()\n',
    });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;
    const barUri = `file://${path.join(repoDir, 'bar.py')}`;
    const fakeClient = {
      openFile: vi.fn(async () => {}),
      references: vi.fn(async () => [
        { uri: barUri, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } } },
        { uri: barUri, range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } } },
      ]),
    };
    (session.lsp as any).get = vi.fn(async () => fakeClient);

    const app = createApp(mgr);
    const resp = await request(app)
      .get(`/project/${slug}/references?file=foo.py&line=0&character=4`);
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe('ok');
    expect(resp.body.result.references).toHaveLength(2);
    expect(resp.body.result.references[0]).toMatchObject({
      file: 'bar.py', line: 2, snippet: 'hello()',
    });
  });

  it('missing LSP returns empty result with status=missing', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    (mgr.get(slug)!.lsp as any).get = vi.fn(async () => null);

    const app = createApp(mgr);
    const resp = await request(app)
      .get(`/project/${slug}/references?file=foo.py&line=0&character=0`);
    expect(resp.body.status).toBe('missing');
    expect(resp.body.result.references).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.server.ts server/__tests__/routes-lsp.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

In `server/app.ts`, after the `/hover` route:

```ts
  projectRouter.get('/references', async (req, res) => {
    const session = res.locals.session;
    const file = (req.query.file as string) ?? '';
    const line = parseInt((req.query.line as string) ?? '-1', 10);
    const character = parseInt((req.query.character as string) ?? '-1', 10);
    if (!file || line < 0 || character < 0) {
      res.status(400).json({ error: 'file, line, character required' });
      return;
    }
    const language = extensionToLanguage(file);
    if (!language) {
      res.json({ status: 'missing', result: { references: [] } });
      return;
    }
    const client = await session.lsp.get(language);
    if (!client) {
      res.json({ status: 'missing', result: { references: [] } });
      return;
    }
    const absPath = path.resolve(session.repoPath, file);
    const cfg = (await import('./lsp/languages.js')).getLanguageConfig(language);
    if (cfg.requiresOpen) await client.openFile(absPath);
    try {
      const locs = await client.references(absPath, { line, character });
      const references = locs.map((loc: any) => {
        const target = fromFileUri(loc.uri);
        let snippet = '';
        try {
          const lines = readFileSync(target, 'utf8').split('\n');
          snippet = (lines[loc.range.start.line] ?? '').trim();
        } catch { /* ignore */ }
        const rel = path.relative(session.repoPath, target) || target;
        return { file: rel, line: loc.range.start.line + 1, snippet };
      });
      res.json({ status: 'ok', result: { references } });
    } catch (err) {
      console.log(`LSP_REFERENCES_FAIL language=${language} error=${(err as Error).message}`);
      res.json({ status: 'fallback', result: { references: [] } });
    }
  });
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --config vitest.config.server.ts server/__tests__/routes-lsp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/__tests__/routes-lsp.test.ts
git commit -m "feat(server): GET /references route"
```

---

### Task 16: `/lsp/debug` endpoint

**Files:**
- Modify: `server/app.ts`
- Modify: `server/__tests__/routes-lsp.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `server/__tests__/routes-lsp.test.ts`:

```ts
describe('GET /project/:slug/lsp/debug', () => {
  it('returns per-language stderr ring buffer and state', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;
    const fakeClient = {
      state: 'ready',
      stderrRing: ['line a', 'line b'],
      openFiles: () => ['/tmp/proj/foo.py'],
    };
    (session.lsp as any).get = vi.fn(async (lang: string) => lang === 'python' ? fakeClient : null);

    const app = createApp(mgr);
    const resp = await request(app).get(`/project/${slug}/lsp/debug`);
    expect(resp.status).toBe(200);
    expect(resp.body.python).toMatchObject({ state: 'ready', stderr: ['line a', 'line b'] });
    expect(resp.body.typescript).toMatchObject({ state: 'missing' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.server.ts server/__tests__/routes-lsp.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

In `server/app.ts`:

```ts
  projectRouter.get('/lsp/debug', async (_req, res) => {
    const session = res.locals.session;
    const result: Record<string, unknown> = {};
    for (const lang of ['python', 'typescript', 'rust'] as const) {
      const client = await session.lsp.get(lang).catch(() => null);
      if (!client) {
        result[lang] = { state: 'missing' };
      } else {
        result[lang] = {
          state: (client as any).state ?? 'unknown',
          stderr: (client as any).stderrRing ?? [],
          openFiles: (client as any).openFiles?.() ?? [],
        };
      }
    }
    res.json(result);
  });
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --config vitest.config.server.ts server/__tests__/routes-lsp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/__tests__/routes-lsp.test.ts
git commit -m "feat(server): GET /lsp/debug route"
```

---

### Task 17: cancellation endpoint

**Files:**
- Modify: `server/app.ts`
- Modify: `server/__tests__/routes-lsp.test.ts`

Frontend calls this to cancel an in-flight peek request when the panel is closed or a new peek supersedes it.

- [ ] **Step 1: Add a failing test**

Append to `server/__tests__/routes-lsp.test.ts`:

```ts
describe('DELETE /project/:slug/lsp/request', () => {
  it('calls client.cancel for the specified method + position', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;
    const cancel = vi.fn();
    const fakeClient = { cancel };
    (session.lsp as any).get = vi.fn(async () => fakeClient);

    const app = createApp(mgr);
    const resp = await request(app)
      .delete(`/project/${slug}/lsp/request?method=definition&file=foo.py&line=0&character=0`);
    expect(resp.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith('definition', expect.stringContaining('foo.py'), { line: 0, character: 0 });
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run --config vitest.config.server.ts server/__tests__/routes-lsp.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

In `server/app.ts`:

```ts
  projectRouter.delete('/lsp/request', async (req, res) => {
    const session = res.locals.session;
    const method = (req.query.method as string) as 'definition' | 'hover' | 'references';
    const file = (req.query.file as string) ?? '';
    const line = parseInt((req.query.line as string) ?? '-1', 10);
    const character = parseInt((req.query.character as string) ?? '-1', 10);
    if (!['definition', 'hover', 'references'].includes(method) || !file || line < 0 || character < 0) {
      res.status(400).json({ error: 'method, file, line, character required' });
      return;
    }
    const language = extensionToLanguage(file);
    if (!language) { res.json({ ok: true }); return; }
    const client = await session.lsp.get(language);
    if (!client) { res.json({ ok: true }); return; }
    const absPath = path.resolve(session.repoPath, file);
    (client as any).cancel(method, absPath, { line, character });
    res.json({ ok: true });
  });
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --config vitest.config.server.ts server/__tests__/routes-lsp.test.ts`
Expected: PASS

- [ ] **Step 5: Server shutdown wiring** — update `server/server.ts`

Find the `SIGINT`/`SIGTERM` handler (or create one if absent). Before `process.exit()`, call `manager.shutdownAll()`:

```ts
process.on('SIGINT', async () => {
  try { await manager.shutdownAll(); } catch { /* ignore */ }
  process.exit(0);
});
process.on('SIGTERM', async () => {
  try { await manager.shutdownAll(); } catch { /* ignore */ }
  process.exit(0);
});
```

(Skip if `server/server.ts` already has SIGINT/SIGTERM handlers — integrate the `shutdownAll()` call into them.)

- [ ] **Step 6: Commit**

```bash
git add server/app.ts server/server.ts server/__tests__/routes-lsp.test.ts
git commit -m "feat(server): DELETE /lsp/request cancellation + graceful shutdown"
```

---

## Phase 4: Frontend wire-up (Tasks 18–23)

### Task 18: Frontend types + API clients + lspStatus signal

**Files:**
- Modify: `frontend/src/state.ts`
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add types and signal to `frontend/src/state.ts`**

Near the top (alongside the other exported types), add:

```ts
export type Language = 'python' | 'typescript' | 'rust';
export type LspStatus = 'ok' | 'indexing' | 'missing' | 'crashed' | 'partial';
```

Find the existing `PeekState` interface (around line 121):

```ts
export interface PeekState {
  filePath: string;
  lineIdx: number;
  symbol: string;
}
```

Add an optional `character` field:

```ts
export interface PeekState {
  filePath: string;
  lineIdx: number;
  symbol: string;
  /** UTF-16 code-unit offset within the line; present when the peek came from a Cmd+click. */
  character?: number;
}
```

In the signal/store section, add:

```ts
const [_lspStatus, _setLspStatus] = createStore<Record<Language, LspStatus>>({
  python: 'missing',
  typescript: 'missing',
  rust: 'missing',
});
export const lspStatus = _lspStatus;

/** Overloaded setter: one language at a time, or a full object replacement. */
export function setLspStatus(language: Language, status: LspStatus): void;
export function setLspStatus(next: Record<Language, LspStatus>): void;
export function setLspStatus(
  arg1: Language | Record<Language, LspStatus>,
  status?: LspStatus,
): void {
  if (typeof arg1 === 'string') _setLspStatus(arg1 as Language, status!);
  else _setLspStatus(arg1);
}
```

- [ ] **Step 2: Add API methods to `frontend/src/api.ts`**

Add these exports after the existing `fetchSymbol`:

```ts
export interface DefinitionPayload {
  result: { symbol: string; results: SymbolResult[] };
  status: 'ok' | 'indexing' | 'fallback' | 'partial' | 'missing';
}

export interface HoverPayload {
  result: { signature?: string; type?: string; docs?: string };
  status: 'ok' | 'fallback' | 'missing';
}

export interface ReferencesPayload {
  result: { references: Array<{ file: string; line: number; snippet: string }> };
  status: 'ok' | 'fallback' | 'missing';
}

function posQuery(file: string, line: number, character: number): string {
  return `file=${encodeURIComponent(file)}&line=${line}&character=${character}`;
}

export async function fetchDefinition(file: string, line: number, character: number): Promise<DefinitionPayload> {
  const resp = await fetch(`${baseUrl()}/definition?${posQuery(file, line, character)}`);
  return checkedJson<DefinitionPayload>(resp);
}

export async function fetchHover(file: string, line: number, character: number): Promise<HoverPayload> {
  const resp = await fetch(`${baseUrl()}/hover?${posQuery(file, line, character)}`);
  return checkedJson<HoverPayload>(resp);
}

export async function fetchReferences(file: string, line: number, character: number): Promise<ReferencesPayload> {
  const resp = await fetch(`${baseUrl()}/references?${posQuery(file, line, character)}`);
  return checkedJson<ReferencesPayload>(resp);
}

export async function cancelLspRequest(
  method: 'definition' | 'hover' | 'references',
  file: string,
  line: number,
  character: number,
): Promise<void> {
  await fetch(
    `${baseUrl()}/lsp/request?method=${method}&${posQuery(file, line, character)}`,
    { method: 'DELETE' },
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build:frontend`
Expected: success

- [ ] **Step 4: Commit**

```bash
git add frontend/src/state.ts frontend/src/api.ts
git commit -m "feat(frontend): add Language/LspStatus types, lspStatus signal, LSP API clients"
```

---

### Task 19: Header status badge component

**Files:**
- Create: `frontend/src/components/header/LspStatusBadge.tsx`
- Create: `frontend/src/__tests__/LspStatusBadge.test.tsx`
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/LspStatusBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import LspStatusBadge from '../components/header/LspStatusBadge';
import { setLspStatus } from '../state';

describe('LspStatusBadge', () => {
  it('renders nothing when all languages are ok', () => {
    setLspStatus({ python: 'ok', typescript: 'ok', rust: 'ok' });
    const { container } = render(() => <LspStatusBadge />);
    expect(container.textContent).toBe('');
  });

  it('renders one chip per non-ok language with its status', () => {
    setLspStatus({ python: 'missing', typescript: 'ok', rust: 'indexing' });
    render(() => <LspStatusBadge />);
    expect(screen.getByText(/py.*missing/i)).toBeTruthy();
    expect(screen.getByText(/rs.*indexing/i)).toBeTruthy();
    expect(screen.queryByText(/ts/i)).toBeNull();
  });

  it('indexing chip shows elapsed seconds', async () => {
    setLspStatus({ python: 'indexing', typescript: 'ok', rust: 'ok' });
    render(() => <LspStatusBadge />);
    // After render, elapsed will start at 0s and tick — just verify the "s" suffix is present.
    expect(screen.getByText(/\d+s/)).toBeTruthy();
  });
});
```

If `@solidjs/testing-library` isn't already a devDependency, also run:

```bash
npm install --save-dev @solidjs/testing-library
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/__tests__/LspStatusBadge.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `frontend/src/components/header/LspStatusBadge.tsx`:

```tsx
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
```

Add styles to `frontend/src/style.css`:

```css
.lsp-status-badge {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 11px;
}
.lsp-chip {
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--bg-subtle, #eee);
  color: var(--muted, #666);
  font-family: ui-monospace, monospace;
}
.lsp-chip-missing { background: #f0f0f0; color: #888; }
.lsp-chip-indexing { background: #fff4d6; color: #8a5a00; }
.lsp-chip-crashed { background: #fdd; color: #a00; }
.lsp-chip-partial { background: #e8f0ff; color: #336; }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run frontend/src/__tests__/LspStatusBadge.test.tsx`
Expected: PASS

- [ ] **Step 5: Mount in header**

Find the existing header component. Use `grep -r "class=\"header\"" frontend/src/` or inspect `frontend/src/App.tsx` / `frontend/src/components/header/` to locate it. Add the import and render:

```tsx
import LspStatusBadge from './LspStatusBadge';
```

and inside the header JSX (next to other small controls like repo name / status indicators):

```tsx
<LspStatusBadge />
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/header/LspStatusBadge.tsx frontend/src/__tests__/LspStatusBadge.test.tsx frontend/src/style.css frontend/src/components/header/Header.tsx
git commit -m "feat(frontend): LspStatusBadge in header"
```

---

### Task 20: Capture UTF-16 character offset in DiffLine Cmd+click

**Files:**
- Modify: `frontend/src/components/diff/DiffLine.tsx`
- Create: `frontend/src/__tests__/character-offset.test.ts`

- [ ] **Step 1: Write a failing unit test**

Create `frontend/src/__tests__/character-offset.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeUtf16Offset } from '../components/diff/DiffLine';

describe('computeUtf16Offset', () => {
  it('returns 0 for empty prefix', () => {
    expect(computeUtf16Offset('', 0)).toBe(0);
  });

  it('returns the substring length for BMP characters', () => {
    expect(computeUtf16Offset('hello.world', 5)).toBe(5);
  });

  it('counts non-BMP characters as 2 UTF-16 code units', () => {
    // "🔥" is U+1F525, a non-BMP char that takes 2 UTF-16 code units.
    // After "🔥" (index 1 in JS string terms), UTF-16 offset is 2.
    const line = '🔥foo';
    // A caret offset of 1 (after the fire emoji) should be UTF-16 offset 2.
    expect(computeUtf16Offset(line, 1)).toBe(2);
  });
});
```

(Note: in a JS string, `'🔥foo'.length` is 5 since `🔥` is 2 code units. But `caretPositionFromPoint` returns DOM text-node offsets which are also UTF-16, so the conversion is trivial — `line.substring(0, offset).length` works both ways. The test documents this invariant.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/__tests__/character-offset.test.ts`
Expected: FAIL (function not exported)

- [ ] **Step 3: Modify `DiffLine.tsx`**

In `frontend/src/components/diff/DiffLine.tsx`, add the exported helper above the component definition:

```ts
/**
 * Convert a caret offset within a line into a UTF-16 code-unit offset. JS strings are already
 * UTF-16 internally so this is just a pass-through, but we name it explicitly so the caller
 * contract with LSP is clear.
 */
export function computeUtf16Offset(line: string, caretOffsetWithinLine: number): number {
  return line.substring(0, caretOffsetWithinLine).length;
}
```

Update `getWordAtClick` to return both the word and the offset:

```ts
function getWordAtClick(e: MouseEvent): { word: string; character: number } | null {
  const sel = document.caretPositionFromPoint?.(e.clientX, e.clientY)
    ?? (document as any).caretRangeFromPoint?.(e.clientX, e.clientY);
  if (!sel) return null;

  const node = 'offsetNode' in sel ? sel.offsetNode : sel.startContainer;
  const offset = 'offset' in sel ? sel.offset : sel.startOffset;
  if (node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.textContent ?? '';
  let start = offset;
  let end = offset;
  while (start > 0 && /[\w]/.test(text[start - 1])) start--;
  while (end < text.length && /[\w]/.test(text[end])) end++;

  const word = text.slice(start, end);
  if (word.length < 2 || !/^[a-zA-Z_]/.test(word)) return null;
  return { word, character: computeUtf16Offset(props.line.content, start) };
}
```

And update the Cmd+click handler to pass `character`:

```ts
if (e.metaKey || e.ctrlKey) {
  const hit = getWordAtClick(e);
  if (hit) {
    setPeekState({
      filePath: props.filePath,
      lineIdx: props.lineIdx,
      symbol: hit.word,
      character: hit.character,
    });
  }
  return;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run frontend/src/__tests__/character-offset.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/diff/DiffLine.tsx frontend/src/__tests__/character-offset.test.ts
git commit -m "feat(frontend): capture UTF-16 character offset in Cmd+click"
```

---

### Task 21: PeekPanel — call /definition, populate hover + references

**Files:**
- Modify: `frontend/src/components/diff/PeekPanel.tsx`
- Modify: `frontend/src/__tests__/PeekPanel.test.tsx` (create)
- Modify: `frontend/src/state.ts`

- [ ] **Step 1: Write a failing test**

Create `frontend/src/__tests__/PeekPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@solidjs/testing-library';
import PeekPanel from '../components/diff/PeekPanel';
import { setPeekState } from '../state';
import * as api from '../api';

describe('PeekPanel', () => {
  it('renders hover signature and references when character is present', async () => {
    vi.spyOn(api, 'fetchDefinition').mockResolvedValue({
      status: 'ok',
      result: { symbol: 'foo', results: [{ file: 'a.py', line: 3, kind: 'function', body: 'def foo(): pass', docstring: null }] },
    });
    vi.spyOn(api, 'fetchHover').mockResolvedValue({
      status: 'ok',
      result: { signature: 'def foo() -> None', docs: 'Noop.' },
    });
    vi.spyOn(api, 'fetchReferences').mockResolvedValue({
      status: 'ok',
      result: { references: [{ file: 'b.py', line: 5, snippet: 'foo()' }] },
    });
    setPeekState({ filePath: 'a.py', lineIdx: 0, symbol: 'foo', character: 4 });
    render(() => <PeekPanel />);
    await waitFor(() => expect(screen.getByText(/def foo\(\) -> None/)).toBeTruthy());
    expect(screen.getByText(/Noop\./)).toBeTruthy();
    expect(screen.getByText(/b\.py:5/)).toBeTruthy();
  });

  it('falls back to fetchSymbol name-search when character is absent (name-search path)', async () => {
    const sym = vi.spyOn(api, 'fetchSymbol').mockResolvedValue({
      symbol: 'foo', results: [{ file: 'x.py', line: 1, kind: 'function', body: 'def foo(): pass', docstring: null }],
    });
    setPeekState({ filePath: 'x.py', lineIdx: 0, symbol: 'foo' });
    render(() => <PeekPanel />);
    await waitFor(() => expect(sym).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/__tests__/PeekPanel.test.tsx`
Expected: FAIL (hover + refs not rendered)

- [ ] **Step 3: Update `PeekPanel.tsx`**

Replace the existing `createResource` block and body with LSP-aware resources. The full replaced file:

```tsx
import { createSignal, createResource, Show, For, onMount, onCleanup } from 'solid-js';
import { peekState, setPeekState, setLspStatus } from '../../state';
import {
  fetchSymbol, fetchDefinition, fetchHover, fetchReferences, cancelLspRequest,
  type SymbolResult,
} from '../../api';
import { highlightLine, detectLang, escapeHtml } from '../../utils';
import { showToast } from '../shared/Toast';
import type { Language } from '../../state';

function languageFromFile(file: string): Language | null {
  const lower = file.toLowerCase();
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.jsx')) return 'typescript';
  if (lower.endsWith('.rs')) return 'rust';
  return null;
}

export default function PeekPanel() {
  const [activeTab, setActiveTab] = createSignal(0);
  const [showAllRefs, setShowAllRefs] = createSignal(false);
  let panelRef: HTMLDivElement | undefined;

  // Definition — LSP when character is present, else name-search fallback
  const [data] = createResource(
    () => peekState(),
    async (state) => {
      if (!state) return null;
      try {
        if (state.character != null) {
          const resp = await fetchDefinition(state.filePath, state.lineIdx, state.character);
          const lang = languageFromFile(state.filePath);
          if (lang) setLspStatus(lang, resp.status === 'ok' ? 'ok' : resp.status === 'indexing' ? 'indexing' : resp.status === 'fallback' ? 'ok' : 'missing');
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

  // Hover + references — only when character is present
  const [hover] = createResource(
    () => peekState()?.character != null ? peekState() : null,
    async (state) => {
      if (!state) return null;
      try {
        const resp = await fetchHover(state.filePath, state.lineIdx, state.character!);
        return resp.result;
      } catch {
        return null;
      }
    },
  );

  const [refs] = createResource(
    () => peekState()?.character != null ? peekState() : null,
    async (state) => {
      if (!state) return [];
      try {
        const resp = await fetchReferences(state.filePath, state.lineIdx, state.character!);
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
    // Cancel any in-flight requests before clearing
    const s = peekState();
    if (s?.character != null) {
      void cancelLspRequest('definition', s.filePath, s.lineIdx, s.character);
      void cancelLspRequest('hover', s.filePath, s.lineIdx, s.character);
      void cancelLspRequest('references', s.filePath, s.lineIdx, s.character);
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
      // Supersede by setting a new peek state (the resource re-runs, old requests get cancelled via handleClose if user clicks close)
      setPeekState({ ...current, symbol: word, character: undefined });
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
  const visibleRefs = () => showAllRefs() ? refs() ?? [] : (refs() ?? []).slice(0, VISIBLE_REFS);

  return (
    <Show when={peekState() && data()?.results?.length}>
      <tr class="peek-row">
        <td colspan="3">
          <div class="peek-panel" ref={panelRef} onKeyDown={handleKeyDown} tabIndex={-1}>
            <div class="peek-header">
              <button class="peek-close" onClick={handleClose} title="Close (Esc)">✕</button>
              <strong class="peek-symbol">{data()!.symbol}</strong>
              <Show when={activeResult()}>
                {(r) => <span class="peek-location">{r().file}:{r().line}</span>}
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

            <Show when={hover()?.signature}>
              <div class="peek-hover">
                <div class="peek-hover-signature">{hover()!.signature}</div>
                <Show when={hover()?.docs}>
                  <div class="peek-hover-docs">{hover()!.docs}</div>
                </Show>
              </div>
            </Show>

            <Show when={activeResult()}>
              {(r) => (
                <>
                  <Show when={r().docstring && !hover()?.signature}>
                    <div class="peek-docstring">{r().docstring}</div>
                  </Show>
                  <pre class="peek-body" onClick={handleBodyClick}><code innerHTML={highlightBody(r())} /></pre>
                </>
              )}
            </Show>

            <Show when={(refs() ?? []).length > 0}>
              <div class="peek-refs">
                <div class="peek-refs-header">References · {(refs() ?? []).length}</div>
                <For each={visibleRefs()}>
                  {(ref) => (
                    <div class="peek-ref">
                      <span class="peek-ref-loc">{ref.file}:{ref.line}</span>
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
```

The `setLspStatus` wrapper introduced in Task 18 supports both `setLspStatus('python', 'ok')` (used here) and `setLspStatus({ python: 'missing', typescript: 'ok', rust: 'indexing' })` (used by the badge test in Task 19). No additional changes to `state.ts` are needed here.

- [ ] **Step 4: Add styles to `frontend/src/style.css`**

```css
.peek-hover {
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  background: var(--bg-subtle, #f8f8f8);
}
.peek-hover-signature { font-weight: 600; }
.peek-hover-docs { color: var(--muted, #666); margin-top: 4px; font-family: inherit; }

.peek-refs {
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  background: var(--bg-subtle, #f8f8f8);
}
.peek-refs-header {
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted, #666);
  font-weight: 600;
  font-size: 11px;
  margin-bottom: 4px;
}
.peek-ref {
  display: flex;
  gap: 10px;
  font-family: ui-monospace, monospace;
  padding: 2px 0;
}
.peek-ref-loc { color: var(--accent, #0066cc); min-width: 180px; }
.peek-ref-snippet { color: var(--muted, #666); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.peek-refs-more {
  margin-top: 6px;
  background: transparent;
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run frontend/src/__tests__/PeekPanel.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/diff/PeekPanel.tsx frontend/src/state.ts frontend/src/style.css frontend/src/__tests__/PeekPanel.test.tsx
git commit -m "feat(frontend): PeekPanel uses /definition, renders hover + references"
```

---

### Task 22: Smoke-test the frontend manually

**Files:** none (manual verification)

- [ ] **Step 1: Start the dev server and UI**

Run: `npm run dev:all`
Wait for `server listening on :9900` and Vite to come up.

- [ ] **Step 2: Register a Python project**

Open the tool against a Python repo that has `ty` installed. Open the peek panel via Cmd+click on a function call.

Expected: PeekPanel shows the definition + hover header (signature) + references list below. Header badge is absent while LSP is `ok`, briefly shows `py: indexing Ns` on first use.

- [ ] **Step 3: Register a JS/TS project**

Open a TS file, Cmd+click a symbol.

Expected: same peek, hover + references populated; the TS integration works. If `typescript-language-server` isn't installed, the badge shows `ts: missing` and the peek still works via ripgrep fallback (definition only, no hover/refs).

- [ ] **Step 4: Register a Rust project**

Open the tool against a Rust repo. Cmd+click in a `.rs` file.

Expected: badge shows `rs: indexing Ns` for up to a few minutes on first launch (cold `cargo check`). Once `rs: ok`, peek + hover + references populate.

- [ ] **Step 5: Don't commit anything**

No code changes this task. If you found bugs, fix them in a new task (or file them and move on).

---

## Phase 5: Integration tests + fixtures (Tasks 23–26)

### Task 23: Python fixture + ty integration test

**Files:**
- Create: `server/__tests__/fixtures/lsp/python/mod_a.py`
- Create: `server/__tests__/fixtures/lsp/python/mod_b.py`
- Create: `server/__tests__/fixtures/lsp/python/mod_c.py`
- Create: `server/__tests__/lsp/integration-ty.test.ts`

- [ ] **Step 1: Create fixture files**

`server/__tests__/fixtures/lsp/python/mod_a.py`:

```python
def greet(name: str) -> str:
    """Return a greeting."""
    return f"hello {name}"
```

`server/__tests__/fixtures/lsp/python/mod_b.py`:

```python
from mod_a import greet

def main() -> None:
    print(greet("world"))
```

`server/__tests__/fixtures/lsp/python/mod_c.py`:

```python
from mod_a import greet

greet("bob")
```

- [ ] **Step 2: Write the integration test**

Create `server/__tests__/lsp/integration-ty.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { LspClient } from '../../lsp/client.js';

const FIXTURES = path.resolve(__dirname, '../fixtures/lsp/python');
const RUN_INTEGRATION = process.env.LSP_INTEGRATION === '1';

describe.skipIf(!RUN_INTEGRATION)('integration: ty (Python LSP)', () => {
  let repoDir: string;
  let client: LspClient;

  beforeAll(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-integration-ty-'));
    for (const f of fs.readdirSync(FIXTURES)) {
      fs.copyFileSync(path.join(FIXTURES, f), path.join(repoDir, f));
    }
    execSync('git init', { cwd: repoDir });

    const child = spawn('ty', ['server'], { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] });
    const conn = createMessageConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!),
    );
    client = new LspClient({ language: 'python', projectPath: repoDir, connection: conn });
    await client.initialize();
    await client.waitReady(10_000);
  }, 30_000);

  afterAll(async () => {
    if (client) await client.shutdown();
    if (repoDir) fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('resolves definition of greet in mod_b.py back to mod_a.py', async () => {
    const modB = path.join(repoDir, 'mod_b.py');
    await client.openFile(modB);
    // "greet" on the `print(greet("world"))` line — find character position
    const src = fs.readFileSync(modB, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('print(greet'));
    const character = src[line].indexOf('greet');
    const locs = await client.definition(modB, { line, character });
    expect(locs.length).toBeGreaterThan(0);
    expect(locs[0].uri).toContain('mod_a.py');
  });

  it('hover on greet returns type info', async () => {
    const modB = path.join(repoDir, 'mod_b.py');
    await client.openFile(modB);
    const src = fs.readFileSync(modB, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('print(greet'));
    const character = src[line].indexOf('greet');
    const hover = await client.hover(modB, { line, character });
    expect(hover).toBeTruthy();
    expect(hover!.toLowerCase()).toMatch(/str|name/);
  });

  it('references to greet include call sites in mod_b and mod_c', async () => {
    const modA = path.join(repoDir, 'mod_a.py');
    await client.openFile(modA);
    await client.openFile(path.join(repoDir, 'mod_b.py'));
    await client.openFile(path.join(repoDir, 'mod_c.py'));
    const src = fs.readFileSync(modA, 'utf8').split('\n');
    const line = src.findIndex((l) => l.startsWith('def greet'));
    const character = src[line].indexOf('greet');
    const refs = await client.references(modA, { line, character });
    // ty's find-references is beta — it may return empty. The test asserts
    // at least a successful round-trip; if results present, they should point at mod_b or mod_c.
    expect(Array.isArray(refs)).toBe(true);
    if (refs.length > 0) {
      const uris = refs.map((r: any) => r.uri);
      expect(uris.some((u: string) => u.includes('mod_b') || u.includes('mod_c'))).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Verify the test skips without the env flag**

Run: `npm run test:server -- lsp/integration-ty`
Expected: skipped / no failures

- [ ] **Step 4: Optional — run with ty installed**

Run: `LSP_INTEGRATION=1 npm run test:server -- lsp/integration-ty`
Expected: PASS if `ty` is installed. Otherwise, the first beforeAll fails with ENOENT — that's fine, the test is still gated behind the env flag.

- [ ] **Step 5: Commit**

```bash
git add server/__tests__/fixtures/lsp/python/ server/__tests__/lsp/integration-ty.test.ts
git commit -m "test(server/lsp): ty integration test + Python fixture"
```

---

### Task 24: TypeScript fixture + integration test

**Files:**
- Create: `server/__tests__/fixtures/lsp/typescript/a.ts`
- Create: `server/__tests__/fixtures/lsp/typescript/b.ts`
- Create: `server/__tests__/fixtures/lsp/typescript/tsconfig.json`
- Create: `server/__tests__/lsp/integration-tsserver.test.ts`

- [ ] **Step 1: Create fixture files**

`server/__tests__/fixtures/lsp/typescript/a.ts`:

```ts
export function greet(name: string): string {
  return `hello ${name}`;
}
```

`server/__tests__/fixtures/lsp/typescript/b.ts`:

```ts
import { greet } from './a.js';
console.log(greet('world'));
```

`server/__tests__/fixtures/lsp/typescript/tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "strict": true
  },
  "include": ["*.ts"]
}
```

- [ ] **Step 2: Write the integration test**

Create `server/__tests__/lsp/integration-tsserver.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { LspClient } from '../../lsp/client.js';

const FIXTURES = path.resolve(__dirname, '../fixtures/lsp/typescript');
const RUN_INTEGRATION = process.env.LSP_INTEGRATION === '1';

describe.skipIf(!RUN_INTEGRATION)('integration: typescript-language-server', () => {
  let repoDir: string;
  let client: LspClient;

  beforeAll(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-integration-ts-'));
    for (const f of fs.readdirSync(FIXTURES)) {
      fs.copyFileSync(path.join(FIXTURES, f), path.join(repoDir, f));
    }
    execSync('git init', { cwd: repoDir });

    const child = spawn('typescript-language-server', ['--stdio'], { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] });
    const conn = createMessageConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!),
    );
    client = new LspClient({ language: 'typescript', projectPath: repoDir, connection: conn });
    await client.initialize();
    await client.waitReady(15_000);
  }, 45_000);

  afterAll(async () => {
    if (client) await client.shutdown();
    if (repoDir) fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('resolves greet from b.ts to a.ts', async () => {
    const b = path.join(repoDir, 'b.ts');
    await client.openFile(b);
    const src = fs.readFileSync(b, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('console.log(greet'));
    const character = src[line].indexOf('greet');
    const locs = await client.definition(b, { line, character });
    expect(locs.length).toBeGreaterThan(0);
    expect(locs[0].uri).toContain('a.ts');
  });

  it('hover shows function signature', async () => {
    const b = path.join(repoDir, 'b.ts');
    await client.openFile(b);
    const src = fs.readFileSync(b, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('console.log(greet'));
    const character = src[line].indexOf('greet');
    const hover = await client.hover(b, { line, character });
    expect(hover).toBeTruthy();
    expect(hover!).toMatch(/greet.*name.*string/);
  });

  it('references to greet include b.ts', async () => {
    const a = path.join(repoDir, 'a.ts');
    await client.openFile(a);
    await client.openFile(path.join(repoDir, 'b.ts'));
    const src = fs.readFileSync(a, 'utf8').split('\n');
    const line = src.findIndex((l) => l.startsWith('export function greet'));
    const character = src[line].indexOf('greet');
    const refs = await client.references(a, { line, character });
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((r: any) => r.uri.includes('b.ts'))).toBe(true);
  });
});
```

- [ ] **Step 3: Verify skip**

Run: `npm run test:server -- lsp/integration-tsserver`
Expected: skipped

- [ ] **Step 4: Commit**

```bash
git add server/__tests__/fixtures/lsp/typescript/ server/__tests__/lsp/integration-tsserver.test.ts
git commit -m "test(server/lsp): typescript-language-server integration test + TS fixture"
```

---

### Task 25: Rust fixture + integration test

**Files:**
- Create: `server/__tests__/fixtures/lsp/rust/Cargo.toml`
- Create: `server/__tests__/fixtures/lsp/rust/src/lib.rs`
- Create: `server/__tests__/fixtures/lsp/rust/src/main.rs`
- Create: `server/__tests__/lsp/integration-rust.test.ts`

- [ ] **Step 1: Create fixture files**

`server/__tests__/fixtures/lsp/rust/Cargo.toml`:

```toml
[package]
name = "lsp-fixture"
version = "0.0.0"
edition = "2021"

[[bin]]
name = "lsp-fixture"
path = "src/main.rs"

[lib]
path = "src/lib.rs"
```

`server/__tests__/fixtures/lsp/rust/src/lib.rs`:

```rust
/// Returns a greeting.
pub fn greet(name: &str) -> String {
    format!("hello {}", name)
}
```

`server/__tests__/fixtures/lsp/rust/src/main.rs`:

```rust
use lsp_fixture::greet;

fn main() {
    println!("{}", greet("world"));
}
```

- [ ] **Step 2: Write the integration test**

Create `server/__tests__/lsp/integration-rust.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { LspClient } from '../../lsp/client.js';

const FIXTURES = path.resolve(__dirname, '../fixtures/lsp/rust');
const RUN_INTEGRATION = process.env.LSP_INTEGRATION === '1';

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

describe.skipIf(!RUN_INTEGRATION)('integration: rust-analyzer', () => {
  let repoDir: string;
  let client: LspClient;

  beforeAll(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-integration-rust-'));
    copyDir(FIXTURES, repoDir);
    execSync('git init', { cwd: repoDir });

    const child = spawn('rust-analyzer', [], { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] });
    const conn = createMessageConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!),
    );
    client = new LspClient({ language: 'rust', projectPath: repoDir, connection: conn });
    await client.initialize();
    await client.waitReady(180_000);
  }, 240_000);

  afterAll(async () => {
    if (client) await client.shutdown();
    if (repoDir) fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('resolves greet from main.rs to lib.rs', async () => {
    const main = path.join(repoDir, 'src/main.rs');
    await client.openFile(main);
    const src = fs.readFileSync(main, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('greet("world")'));
    const character = src[line].indexOf('greet');
    const locs = await client.definition(main, { line, character });
    expect(locs.length).toBeGreaterThan(0);
    expect(locs[0].uri).toContain('lib.rs');
  }, 60_000);

  it('hover on greet shows fn signature', async () => {
    const main = path.join(repoDir, 'src/main.rs');
    await client.openFile(main);
    const src = fs.readFileSync(main, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('greet("world")'));
    const character = src[line].indexOf('greet');
    const hover = await client.hover(main, { line, character });
    expect(hover).toBeTruthy();
    expect(hover!).toMatch(/fn greet/);
  }, 60_000);

  it('references to greet include main.rs', async () => {
    const lib = path.join(repoDir, 'src/lib.rs');
    await client.openFile(lib);
    await client.openFile(path.join(repoDir, 'src/main.rs'));
    const src = fs.readFileSync(lib, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('pub fn greet'));
    const character = src[line].indexOf('greet');
    const refs = await client.references(lib, { line, character });
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((r: any) => r.uri.includes('main.rs'))).toBe(true);
  }, 60_000);
});
```

- [ ] **Step 3: Verify skip**

Run: `npm run test:server -- lsp/integration-rust`
Expected: skipped

- [ ] **Step 4: Commit**

```bash
git add server/__tests__/fixtures/lsp/rust/ server/__tests__/lsp/integration-rust.test.ts
git commit -m "test(server/lsp): rust-analyzer integration test + Rust fixture"
```

---

### Task 26: Full-suite verification

**Files:** none

- [ ] **Step 1: Run the full server test suite**

Run: `npm run test:server`
Expected: all unit + route tests pass; integration tests are skipped.

- [ ] **Step 2: Run the frontend test suite**

Run: `npm run test:frontend`
Expected: all frontend tests pass.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Run the build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Optional — run integration tests if LSPs are installed**

Run: `LSP_INTEGRATION=1 npm run test:server`
Expected: all three integration tests pass if binaries present; skipped-with-ENOENT otherwise.

- [ ] **Step 6: No commit needed** — this task is verification.
