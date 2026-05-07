export declare function gitRun(repoPath: string, ...args: string[]): string;
export declare function detectBaseBranch(repoPath: string): string;
export declare function getBranchDiff(repoPath: string, baseBranch: string): string;
export interface RawDiffEntry {
    oldBlob: string;
    newBlob: string;
    status: string;
}
/**
 * One-shot branch diff metadata: returns blob SHAs and status code per file.
 * Single git invocation — used to compute analysis freshness without N spawns.
 *
 * Output of `git diff --raw --no-abbrev <base>...HEAD` is one line per file:
 *   :100644 100644 <40-hex-old> <40-hex-new> M\tpath/to/file.ts
 *   :000000 100644 0000000...0 <40-hex-new> A\tnew/file.ts                 (added)
 *   :100644 000000 <40-hex-old> 0000000...0 D\told/file.ts                 (deleted)
 *   :100644 100644 <40-hex-old> <40-hex-new> R100\told/path\tnew/path      (rename)
 *
 * `--no-abbrev` forces full 40-char SHAs regardless of user's core.abbrev config.
 */
export declare function getBranchDiffRaw(repoPath: string, baseBranch: string): Map<string, RawDiffEntry>;
export declare function getSelectedCommitsDiff(repoPath: string, shas: string[]): string;
interface Commit {
    sha: string;
    message: string;
    author: string;
    date: string;
}
export declare function getBranchCommits(repoPath: string, baseBranch: string): Commit[];
export declare function parseOwnerRepo(url: string): {
    owner: string;
    repo: string;
} | undefined;
export interface RepoMeta {
    branch: string;
    baseBranch: string;
    repoPath: string;
    repoName: string;
    pr?: {
        url: string;
        number: number;
        title: string;
        owner: string;
        repo: string;
    };
}
export declare function getRepoMeta(repoPath: string, baseBranch: string): RepoMeta;
export declare function getRepoMetaAsync(repoPath: string, baseBranch: string): Promise<RepoMeta>;
export interface FileLine {
    num: number;
    content: string;
}
export declare function getFileLines(repoPath: string, filepath: string, start: number, count: number, direction?: string): FileLine[];
export {};
