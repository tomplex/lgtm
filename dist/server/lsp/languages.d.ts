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
export declare function extensionToLanguage(filename: string): Language | null;
export declare function getLanguageConfig(language: Language): LanguageConfig;
