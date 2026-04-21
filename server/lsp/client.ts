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
