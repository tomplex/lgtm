import type { ChildProcess } from 'node:child_process';
import { type MessageConnection } from 'vscode-jsonrpc/node.js';
import { type Language } from './types.js';
type ClientState = 'initializing' | 'indexing' | 'ready' | 'crashed' | 'shuttingDown';
interface LspClientOptions {
    language: Language;
    projectPath: string;
    connection: MessageConnection;
    stderrLines?: number;
    requestTimeoutMs?: number;
}
export declare class LspClient {
    readonly language: Language;
    readonly projectPath: string;
    readonly stderrRing: string[];
    private readonly _connection;
    private readonly _stderrCap;
    private _state;
    private _capabilities;
    private _readyWaiters;
    private readonly _openFiles;
    private _child;
    private readonly _requestTimeoutMs;
    private readonly _inflight;
    constructor(opts: LspClientOptions);
    get state(): ClientState;
    get capabilities(): Record<string, unknown>;
    initialize(): Promise<void>;
    waitReady(timeoutMs: number): Promise<void>;
    private _request;
    cancel(method: 'definition' | 'hover' | 'references', filePath: string, pos: {
        line: number;
        character: number;
    }): void;
    definition(filePath: string, pos: {
        line: number;
        character: number;
    }): Promise<{
        uri: string;
        range: {
            start: {
                line: number;
                character: number;
            };
            end: {
                line: number;
                character: number;
            };
        };
    }[]>;
    hover(filePath: string, pos: {
        line: number;
        character: number;
    }): Promise<string | null>;
    references(filePath: string, pos: {
        line: number;
        character: number;
    }): Promise<{
        uri: string;
        range: {
            start: {
                line: number;
                character: number;
            };
            end: {
                line: number;
                character: number;
            };
        };
    }[]>;
    openFile(filePath: string): Promise<void>;
    closeFile(filePath: string): Promise<void>;
    isOpen(filePath: string): boolean;
    openFiles(): string[];
    attachChild(child: ChildProcess): void;
    markCrashed(reason: string): void;
    shutdown(): Promise<void>;
    appendStderr(line: string): void;
}
export {};
