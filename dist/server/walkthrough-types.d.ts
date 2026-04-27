/** New-side line range within a file, 1-based inclusive start, count of lines. */
export interface HunkRef {
    newStart: number;
    newLines: number;
}
export interface StopArtifact {
    /** Repo-relative file path. */
    file: string;
    /** One or more new-side hunk ranges this artifact covers. */
    hunks: HunkRef[];
    /** Optional inline narrative banner rendered above this artifact. */
    banner?: string;
}
export interface Stop {
    /** Stable id, e.g. "stop-1". */
    id: string;
    /** 1-based position in the walkthrough. */
    order: number;
    title: string;
    /** Markdown-safe paragraph ~30-100 words. */
    narrative: string;
    importance: 'primary' | 'supporting' | 'minor';
    artifacts: StopArtifact[];
}
export interface Walkthrough {
    /** Opening summary paragraph (what this PR is). */
    summary: string;
    /** Ordered list of stops. */
    stops: Stop[];
    /** sha256 hex of the unified diff at generation time. */
    diffHash: string;
    /** ISO 8601 timestamp. */
    generatedAt: string;
}
