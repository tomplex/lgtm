import type { Comment, CommentFilter, CreateComment } from './comment-types.js';
export declare class CommentStore {
    private _comments;
    add(input: CreateComment): Comment;
    get(id: string): Comment | undefined;
    update(id: string, fields: Partial<Pick<Comment, 'text' | 'status'>>): Comment | undefined;
    delete(id: string): boolean;
    list(filter?: CommentFilter): Comment[];
    toJSON(): Comment[];
    static fromJSON(data: Comment[]): CommentStore;
}
