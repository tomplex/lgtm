export interface ProjectBlob {
    slug: string;
    repoPath: string;
    baseBranch: string;
    description: string;
    items: {
        id: string;
        type: 'diff' | 'document';
        title: string;
        path?: string;
    }[];
    comments: import('./comment-types.js').Comment[];
    analysis: Record<string, unknown> | null;
    rounds: Record<string, number>;
    reviewedFiles: string[];
    sidebarView: string;
}
export declare function initStore(dbPath?: string): void;
export declare function closeStore(): void;
export declare function storeGet(slug: string): ProjectBlob | null;
export declare function storePut(slug: string, blob: ProjectBlob): void;
export declare function storeDelete(slug: string): void;
export declare function storeList(): ProjectBlob[];
