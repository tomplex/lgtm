// server/comment-store.ts

import type { Comment, CommentFilter, CreateComment } from './comment-types.js';

export class CommentStore {
  private _comments: Comment[] = [];

  add(input: CreateComment): Comment {
    const comment: Comment = {
      ...input,
      id: crypto.randomUUID(),
      status: 'active',
    };
    this._comments.push(comment);
    return comment;
  }

  get(id: string): Comment | undefined {
    return this._comments.find(c => c.id === id);
  }

  update(id: string, fields: Partial<Pick<Comment, 'text' | 'status'>>): Comment | undefined {
    const comment = this.get(id);
    if (!comment) return undefined;
    if (fields.text !== undefined) comment.text = fields.text;
    if (fields.status !== undefined) comment.status = fields.status;
    return comment;
  }

  delete(id: string): boolean {
    const idx = this._comments.findIndex(c => c.id === id);
    if (idx === -1) return false;
    this._comments.splice(idx, 1);
    return true;
  }

  list(filter?: CommentFilter): Comment[] {
    if (!filter) return [...this._comments];
    return this._comments.filter(c => {
      if (filter.item !== undefined && c.item !== filter.item) return false;
      if (filter.file !== undefined && c.file !== filter.file) return false;
      if (filter.author !== undefined && c.author !== filter.author) return false;
      if (filter.parentId !== undefined && c.parentId !== filter.parentId) return false;
      if (filter.mode !== undefined && c.mode !== filter.mode) return false;
      if (filter.status !== undefined && c.status !== filter.status) return false;
      return true;
    });
  }

  toJSON(): Comment[] {
    return [...this._comments];
  }

  static fromJSON(data: Comment[]): CommentStore {
    const store = new CommentStore();
    store._comments = [...data];
    return store;
  }
}
