import { type ProjectBlob } from './store.js';
import type { Comment, CreateComment, CommentFilter } from './comment-types.js';
interface SessionItem {
    id: string;
    type: 'diff' | 'document';
    title: string;
    path?: string;
}
export interface SSEClient {
    send: (event: string, data: unknown) => void;
}
export declare class Session {
    readonly repoPath: string;
    readonly baseBranch: string;
    readonly description: string;
    readonly outputPath: string;
    private _slug;
    private _rounds;
    private _items;
    private _commentStore;
    private _sseClients;
    private _analysis;
    private _reviewedFiles;
    private _sidebarView;
    constructor(opts: {
        repoPath: string;
        baseBranch: string;
        description?: string;
        outputPath?: string;
        slug?: string;
    });
    toBlob(): ProjectBlob;
    persist(): void;
    static fromBlob(blob: Record<string, unknown>, outputPath: string): Session;
    get items(): SessionItem[];
    get analysis(): Record<string, unknown> | null;
    getItemData(itemId: string, commits?: string): Record<string, unknown>;
    setAnalysis(analysis: Record<string, unknown>): void;
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
    updateComment(id: string, fields: Partial<Pick<Comment, 'text' | 'status'>>): Comment | undefined;
    deleteComment(itemId: string, commentId: string): boolean;
    clearComments(itemId?: string): void;
    get userReviewedFiles(): string[];
    get userSidebarView(): string;
    setUserReviewedFiles(files: string[]): void;
    toggleUserReviewedFile(path: string): boolean;
    setUserSidebarView(view: string): void;
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
