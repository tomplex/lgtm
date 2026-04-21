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
