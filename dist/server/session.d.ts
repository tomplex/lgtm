import { type RepoMeta } from './git-ops.js';
import { type AnalysisFreshness } from './freshness.js';
import { type ProjectBlob } from './store.js';
import type { Comment, CreateComment, CommentFilter } from './comment-types.js';
import { LspManager } from './lsp/index.js';
import type { Walkthrough } from './walkthrough-types.js';
import type { FileAnalysis, AnalysisGroup } from './parse-analysis.js';
interface SessionItem {
    id: string;
    type: 'diff' | 'document';
    title: string;
    path?: string;
}
export interface SidebarPrefs {
    sortMode: 'path' | 'priority';
    groupMode: 'none' | 'phase';
    groupModeUserTouched: boolean;
    collapsedFolders: Record<string, boolean>;
}
export interface SSEClient {
    send: (event: string, data: unknown) => void;
}
export declare class Session {
    readonly repoPath: string;
    baseBranch: string;
    description: string;
    readonly outputPath: string;
    private _slug;
    private _rounds;
    private _items;
    private _commentStore;
    private _sseClients;
    private _analysis;
    private _walkthrough;
    private _reviewedFiles;
    private _sortMode;
    private _groupMode;
    private _groupModeUserTouched;
    private _collapsedFolders;
    private _metaCache;
    private _freshnessCache;
    private _lsp;
    constructor(opts: {
        repoPath: string;
        baseBranch: string;
        description?: string;
        outputPath?: string;
        slug?: string;
    });
    get lsp(): LspManager;
    destroy(): Promise<void>;
    toBlob(): ProjectBlob;
    persist(): void;
    static fromBlob(blob: Record<string, unknown>, outputPath: string): Session;
    get items(): SessionItem[];
    getCachedMeta(ttlMs?: number): Promise<RepoMeta>;
    get analysis(): Record<string, unknown> | null;
    get walkthrough(): Walkthrough | null;
    getItemData(itemId: string, commits?: string): Record<string, unknown>;
    setAnalysis(analysis: Record<string, unknown>): void;
    getAnalysisWithFreshness(): {
        analysis: Record<string, unknown>;
        freshness: AnalysisFreshness;
        computedAtHead: string;
        computedAtBase: string;
    } | null;
    /** Returns the raw diff blob map alongside HEAD/base SHAs. Used by set_analysis call sites. */
    getCurrentBlobMap(): {
        blobsByPath: Record<string, {
            oldBlob: string;
            newBlob: string;
        }>;
        headSha: string;
        baseSha: string;
    };
    /**
     * Merge new file entries into the existing analysis, drop entries listed in
     * removedFiles, and (if synthesisIfProvided is non-null) replace the synthesis.
     * Stamps blob SHAs on every entry written.
     */
    mergeAnalysis(input: {
        files: Record<string, FileAnalysis>;
        synthesisIfProvided: {
            overview: string;
            reviewStrategy: string;
            opinion?: string;
            groups: AnalysisGroup[];
            synthesizedAtFileSet: string[];
        } | null;
        blobsByPath: Record<string, {
            oldBlob: string;
            newBlob: string;
        }>;
        removedFiles: string[];
    }): void;
    setWalkthrough(walkthrough: Walkthrough): void;
    clearWalkthrough(): void;
    addItem(itemId: string, title: string, filepath: string): Record<string, unknown>;
    removeItem(itemId: string): boolean;
    submitReview(commentsText: string, item?: string): Promise<number>;
    addComment(input: CreateComment): Comment;
    addComments(itemId: string, comments: {
        file?: string;
        line?: number;
        block?: number;
        comment: string;
    }[]): number;
    getComment(id: string): Comment | undefined;
    listComments(filter?: CommentFilter): Comment[];
    updateComment(id: string, fields: Partial<Pick<Comment, 'text' | 'status' | 'resolution'>>): Comment | undefined;
    /** Mark comments resolved with a note describing how each was addressed. Persists once. */
    resolveComments(resolutions: {
        id: string;
        note: string;
    }[]): {
        resolved: string[];
        notFound: string[];
    };
    deleteComment(itemId: string, commentId: string): boolean;
    clearComments(itemId?: string): void;
    get userReviewedFiles(): string[];
    get userSidebarPrefs(): SidebarPrefs;
    setUserReviewedFiles(files: string[]): void;
    toggleUserReviewedFile(path: string): boolean;
    setUserSidebarPrefs(prefs: Partial<SidebarPrefs>): void;
    subscribe(client: SSEClient): void;
    unsubscribe(client: SSEClient): void;
    broadcast(event: string, data: unknown): void;
    private _pollTimer;
    private _lastIndexMtime;
    private _lastHeadContent;
    watchRepo(): void;
    unwatchRepo(): void;
}
export {};
