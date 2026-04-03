import type { Comment } from './comment-types.js';
interface NewBlob {
    comments: Comment[];
    [key: string]: unknown;
}
export declare function migrateBlob(blob: Record<string, unknown>): NewBlob;
export {};
