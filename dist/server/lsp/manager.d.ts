import { LspClient } from './client.js';
import type { Language, LspStatus } from './types.js';
type ClientFactory = (language: Language, projectPath: string) => Promise<LspClient>;
interface LspManagerOptions {
    projectPath: string;
    /** For tests; defaults to spawning real LSP binaries. */
    clientFactory?: ClientFactory;
}
export declare class LspManager {
    readonly projectPath: string;
    private readonly _factory;
    private _clients;
    private _known;
    private _shuttingDown;
    constructor(opts: LspManagerOptions);
    get(language: Language): Promise<LspClient | null>;
    status(language: Language): LspStatus;
    /** Forget a prior 'missing' verdict so the next get() retries spawning. */
    resetKnown(language: Language): void;
    shutdown(): Promise<void>;
}
export {};
