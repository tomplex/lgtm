export interface SymbolResult {
    file: string;
    line: number;
    kind: 'function' | 'class' | 'interface' | 'type' | 'variable';
    body: string;
    docstring: string | null;
}
export declare function sortResults(results: SymbolResult[], diffFiles: Set<string>): SymbolResult[];
export declare function findSymbol(repoPath: string, symbol: string): SymbolResult[];
