export type Language = 'python' | 'typescript' | 'rust';
export type LspStatus = 'ok' | 'indexing' | 'missing' | 'crashed' | 'partial';
export interface LspPosition {
    line: number;
    character: number;
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
    line: number;
    snippet: string;
}
export interface Diagnostic {
    line: number;
    character: number;
    endLine: number;
    endCharacter: number;
    severity: 'error' | 'warning' | 'info' | 'hint';
    message: string;
    source?: string;
}
export type LspRequestStatus = 'ok' | 'indexing' | 'fallback' | 'partial' | 'missing';
export declare class LspTimeoutError extends Error {
    constructor(method: string, ms: number);
}
export declare class LspShuttingDownError extends Error {
    constructor();
}
