import { spawn } from 'node:child_process';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import { LspClient } from './client.js';
import { getLanguageConfig } from './languages.js';
import { spawnEnv } from './bootstrap.js';
async function defaultClientFactory(language, projectPath) {
    const cfg = getLanguageConfig(language);
    const child = spawn(cfg.command, cfg.args, {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: spawnEnv(),
    });
    const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
    const client = new LspClient({ language, projectPath, connection });
    // If the binary itself is missing, spawn emits 'error' asynchronously.
    const errPromise = new Promise((_, reject) => {
        child.once('error', (err) => reject(err));
    });
    child.stderr?.on('data', (buf) => {
        for (const line of buf.toString('utf8').split('\n')) {
            if (line)
                client.appendStderr(line);
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
    projectPath;
    _factory;
    _clients = new Map();
    _known = new Map();
    _shuttingDown = false;
    constructor(opts) {
        this.projectPath = opts.projectPath;
        this._factory = opts.clientFactory ?? defaultClientFactory;
    }
    async get(language) {
        if (this._shuttingDown)
            return null;
        if (this._known.get(language) === 'missing')
            return null;
        const existing = this._clients.get(language);
        if (existing)
            return existing;
        try {
            const client = await this._factory(language, this.projectPath);
            this._clients.set(language, client);
            this._known.set(language, 'ok');
            return client;
        }
        catch (err) {
            const e = err;
            if (e?.code === 'ENOENT' || /ENOENT/.test(e?.message ?? '')) {
                console.log(`LSP_MISSING language=${language} reason=ENOENT`);
                this._known.set(language, 'missing');
                return null;
            }
            throw err;
        }
    }
    status(language) {
        const known = this._known.get(language);
        if (known === 'missing')
            return 'missing';
        const client = this._clients.get(language);
        if (!client)
            return 'missing';
        const s = client.state;
        if (s === 'ready')
            return 'ok';
        if (s === 'indexing' || s === 'initializing')
            return 'indexing';
        if (s === 'crashed')
            return 'crashed';
        return 'missing';
    }
    /** Forget a prior 'missing' verdict so the next get() retries spawning. */
    resetKnown(language) {
        this._known.delete(language);
    }
    async shutdown() {
        this._shuttingDown = true;
        const promises = [];
        for (const client of this._clients.values()) {
            promises.push(client.shutdown().catch(() => { }));
        }
        await Promise.all(promises);
        this._clients.clear();
    }
}
