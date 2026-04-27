export interface SymbolResult {
    file: string;
    line: number;
    kind: 'function' | 'class' | 'interface' | 'type' | 'variable';
    body: string;
    docstring: string | null;
}
export declare function detectKind(lineText: string): SymbolResult['kind'];
export declare function extractPythonBody(lines: string[], startIndex: number): string;
export declare function extractTypeScriptBody(lines: string[], startIndex: number): string;
export declare function extractPythonDocstring(lines: string[], startIndex: number): string | null;
export declare function extractJsDocstring(lines: string[], startIndex: number): string | null;
export declare function sortResults(results: SymbolResult[], diffFiles: Set<string>): SymbolResult[];
export declare function findSymbol(repoPath: string, symbol: string): SymbolResult[];
