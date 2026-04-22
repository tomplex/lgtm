import * as fs from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { CancellationTokenSource, type MessageConnection } from 'vscode-jsonrpc/node.js';
import { getLanguageConfig } from './languages.js';
import { toFileUri } from './uri.js';
import { LspTimeoutError, LspShuttingDownError, type Language } from './types.js';

type ClientState = 'initializing' | 'indexing' | 'ready' | 'crashed' | 'shuttingDown';

interface LspClientOptions {
  language: Language;
  projectPath: string;
  connection: MessageConnection;
  stderrLines?: number;
  requestTimeoutMs?: number;
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
  private readonly _openFiles = new Set<string>();
  private _child: ChildProcess | null = null;
  private readonly _requestTimeoutMs: number;
  private readonly _inflight = new Map<string, { promise: Promise<unknown>; source: CancellationTokenSource }>();

  constructor(opts: LspClientOptions) {
    this.language = opts.language;
    this.projectPath = opts.projectPath;
    this._connection = opts.connection;
    this._stderrCap = opts.stderrLines ?? 100;
    this._requestTimeoutMs = opts.requestTimeoutMs ?? 5000;

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

  cancel(method: 'definition' | 'hover' | 'references', filePath: string, pos: { line: number; character: number }): void {
    const key = `${method}:${filePath}:${pos.line}:${pos.character}`;
    const entry = this._inflight.get(key);
    if (entry) entry.source.cancel();
  }

  async definition(filePath: string, pos: { line: number; character: number }) {
    const uri = toFileUri(filePath);
    const key = `definition:${filePath}:${pos.line}:${pos.character}`;
    const result = await this._request<unknown>(
      'textDocument/definition',
      { textDocument: { uri }, position: pos },
      key,
    );
    if (!result) return [];
    return (Array.isArray(result) ? result : [result]) as Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>;
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
    const c = result.contents as unknown;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((x: unknown) => typeof x === 'string' ? x : ((x as { value?: string }).value ?? '')).join('\n');
    return (c as { value?: string }).value ?? null;
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

  appendStderr(line: string): void {
    this.stderrRing.push(line);
    if (this.stderrRing.length > this._stderrCap) this.stderrRing.shift();
  }
}
