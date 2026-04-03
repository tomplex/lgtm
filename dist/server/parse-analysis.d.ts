export interface FileAnalysis {
    priority: 'critical' | 'important' | 'normal' | 'low';
    phase: 'review' | 'skim' | 'rubber-stamp';
    summary: string;
    category: string;
}
export interface AnalysisGroup {
    name: string;
    description?: string;
    files: string[];
}
export interface Synthesis {
    overview: string;
    reviewStrategy: string;
    opinion: string;
    groups: AnalysisGroup[];
}
export declare function parseFileAnalysis(input: string): Record<string, FileAnalysis>;
export declare function parseSynthesis(input: string): Synthesis;
