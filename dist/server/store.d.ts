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
    walkthrough: import('./walkthrough-types.js').Walkthrough | null;
    rounds: Record<string, number>;
    reviewedFiles: string[];
    sortMode: 'path' | 'priority';
    groupMode: 'none' | 'phase';
    groupModeUserTouched: boolean;
    collapsedFolders: Record<string, boolean>;
}
export declare function initStore(dbPath?: string): void;
export declare function closeStore(): void;
export declare function storeGet(slug: string): ProjectBlob | null;
export declare function storePut(slug: string, blob: ProjectBlob): void;
export declare function storeDelete(slug: string): void;
export declare function storeList(): ProjectBlob[];
