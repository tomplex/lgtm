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
