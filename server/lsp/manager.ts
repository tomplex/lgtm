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

async function defaultClientFactory(language: Language, projectPath: string): Promise<LspClient> {
  const cfg = getLanguageConfig(language);
  let child: ChildProcess;
  try {
    child = spawn(cfg.command, cfg.args, {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
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
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code === 'ENOENT' || /ENOENT/.test(e?.message ?? '')) {
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
