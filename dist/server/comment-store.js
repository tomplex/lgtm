// server/comment-store.ts
export class CommentStore {
    _comments = [];
    add(input) {
        const comment = {
            ...input,
            id: crypto.randomUUID(),
            status: 'active',
        };
        this._comments.push(comment);
        return comment;
    }
    get(id) {
        return this._comments.find(c => c.id === id);
    }
    update(id, fields) {
        const comment = this.get(id);
        if (!comment)
            return undefined;
        if (fields.text !== undefined)
            comment.text = fields.text;
        if (fields.status !== undefined)
            comment.status = fields.status;
        return comment;
    }
    delete(id) {
        const idx = this._comments.findIndex(c => c.id === id);
        if (idx === -1)
            return false;
        this._comments.splice(idx, 1);
        return true;
    }
    list(filter) {
        if (!filter)
            return [...this._comments];
        return this._comments.filter(c => {
            if (filter.item !== undefined && c.item !== filter.item)
                return false;
            if (filter.file !== undefined && c.file !== filter.file)
                return false;
            if (filter.author !== undefined && c.author !== filter.author)
                return false;
            if (filter.parentId !== undefined && c.parentId !== filter.parentId)
                return false;
            if (filter.mode !== undefined && c.mode !== filter.mode)
                return false;
            if (filter.status !== undefined && c.status !== filter.status)
                return false;
            return true;
        });
    }
    toJSON() {
        return [...this._comments];
    }
    static fromJSON(data) {
        const store = new CommentStore();
        store._comments = [...data];
        return store;
    }
}
