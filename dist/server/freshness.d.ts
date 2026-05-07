import type { FileAnalysis } from './parse-analysis.js';
import type { RawDiffEntry } from './git-ops.js';
export interface AnalysisFreshness {
    staleFiles: string[];
    missingFiles: string[];
    removedFiles: string[];
    staleSynthesis: boolean;
}
export interface ComputeFreshnessInput {
    storedFiles: Record<string, FileAnalysis>;
    currentDiff: Map<string, RawDiffEntry>;
    synthesizedAtFileSet: string[];
}
export declare function computeFreshness(input: ComputeFreshnessInput): AnalysisFreshness;
