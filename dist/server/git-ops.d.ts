export declare function gitRun(repoPath: string, ...args: string[]): string;
export declare function detectBaseBranch(repoPath: string): string;
export declare function getBranchDiff(repoPath: string, baseBranch: string): string;
export declare function getSelectedCommitsDiff(repoPath: string, shas: string[]): string;
interface Commit {
    sha: string;
    message: string;
    author: string;
    date: string;
}
export declare function getBranchCommits(repoPath: string, baseBranch: string): Commit[];
export interface RepoMeta {
    branch: string;
    baseBranch: string;
    repoPath: string;
    repoName: string;
    pr?: {
        url: string;
        number: number;
        title: string;
    };
}
export declare function getRepoMeta(repoPath: string, baseBranch: string): RepoMeta;
export interface FileLine {
    num: number;
    content: string;
}
export declare function getFileLines(repoPath: string, filepath: string, start: number, count: number, direction?: string): FileLine[];
export {};
