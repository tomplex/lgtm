export class LspTimeoutError extends Error {
    constructor(method, ms) {
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
