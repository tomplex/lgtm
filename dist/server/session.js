import { existsSync, readFileSync, statSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getBranchDiff, getSelectedCommitsDiff, getRepoMeta, } from './git-ops.js';
import { storePut } from './store.js';
import { CommentStore } from './comment-store.js';
import { migrateBlob } from './comment-migration.js';
// --- Session ---
export class Session {
    repoPath;
    baseBranch;
    description;
    outputPath;
    _slug = '';
    _rounds = {};
    _items = [
        { id: 'diff', type: 'diff', title: 'Code Changes' },
    ];
    _commentStore = new CommentStore();
    _sseClients = [];
    _analysis = null;
    _reviewedFiles = new Set();
    _sidebarView = 'flat';
    constructor(opts) {
        this.repoPath = opts.repoPath;
        this.baseBranch = opts.baseBranch;
        this.description = opts.description ?? '';
        this.outputPath = opts.outputPath ?? '';
        this._slug = opts.slug ?? '';
    }
    // --- Persistence ---
    toBlob() {
        return {
            slug: this._slug,
            repoPath: this.repoPath,
            baseBranch: this.baseBranch,
            description: this.description,
            items: this._items,
            comments: this._commentStore.toJSON(),
            analysis: this._analysis,
            rounds: this._rounds,
            reviewedFiles: Array.from(this._reviewedFiles),
            sidebarView: this._sidebarView,
        };
    }
    persist() {
        if (!this._slug)
            return;
        storePut(this._slug, this.toBlob());
    }
    static fromBlob(blob, outputPath) {
        const migrated = migrateBlob(blob);
        const session = new Session({
            repoPath: migrated.repoPath,
            baseBranch: migrated.baseBranch,
            description: migrated.description,
            outputPath,
            slug: migrated.slug,
        });
        session._items = migrated.items;
        session._commentStore = CommentStore.fromJSON(migrated.comments);
        session._analysis = migrated.analysis;
        // Migrate old single round to per-item rounds
        if (migrated.rounds && typeof migrated.rounds === 'object' && !Array.isArray(migrated.rounds)) {
            session._rounds = migrated.rounds;
        }
        else if (typeof migrated.round === 'number' && migrated.round > 0) {
            session._rounds = { diff: migrated.round };
        }
        session._reviewedFiles = new Set(migrated.reviewedFiles);
        session._sidebarView = migrated.sidebarView ?? 'flat';
        return session;
    }
    // --- Queries ---
    get items() {
        return this._items;
    }
    get analysis() {
        return this._analysis;
    }
    getItemData(itemId, commits) {
        const comments = this._commentStore.list({ item: itemId });
        if (itemId === 'diff') {
            let diff;
            if (commits) {
                const shas = commits.split(',').map(s => s.trim()).filter(Boolean);
                diff = getSelectedCommitsDiff(this.repoPath, shas);
            }
            else {
                diff = getBranchDiff(this.repoPath, this.baseBranch);
            }
            return {
                mode: 'diff',
                diff,
                description: this.description,
                meta: getRepoMeta(this.repoPath, this.baseBranch),
                comments,
            };
        }
        const item = this._items.find(i => i.id === itemId);
        if (!item) {
            return { mode: 'error', error: `Item not found: ${itemId}` };
        }
        const p = item.path;
        const content = existsSync(p) ? readFileSync(p, 'utf-8') : '';
        const filename = p.split('/').pop();
        const isMarkdown = /\.(md|mdx|markdown)$/.test(filename);
        return {
            mode: 'file',
            content,
            filename,
            filepath: p,
            markdown: isMarkdown,
            title: item.title ?? filename,
            comments,
        };
    }
    // --- Mutations ---
    setAnalysis(analysis) {
        this._analysis = analysis;
        this.persist();
    }
    addItem(itemId, title, filepath) {
        const absPath = resolve(filepath);
        const existing = this._items.find(i => i.id === itemId);
        if (existing) {
            existing.path = absPath;
            existing.title = title;
        }
        else {
            this._items.push({ id: itemId, type: 'document', title, path: absPath });
        }
        this.persist();
        return { ok: true, id: itemId, items: this._items };
    }
    removeItem(itemId) {
        if (itemId === 'diff')
            return false;
        const idx = this._items.findIndex(i => i.id === itemId);
        if (idx === -1)
            return false;
        this._items.splice(idx, 1);
        this.clearComments(itemId);
        this.persist();
        return true;
    }
    async submitReview(commentsText, item) {
        const key = item || 'diff';
        this._rounds[key] = (this._rounds[key] || 0) + 1;
        const currentRound = this._rounds[key];
        this.persist();
        const label = key === 'diff' ? '' : ` [${key}]`;
        await appendFile(this.outputPath, `\n---\n# Review Round ${currentRound}${label}\n\n${commentsText}\n`);
        await writeFile(this.outputPath + '.signal', `${key}:${currentRound}`);
        return currentRound;
    }
    // --- Comments ---
    addComment(input) {
        const comment = this._commentStore.add(input);
        this.persist();
        return comment;
    }
    addComments(itemId, comments) {
        for (const c of comments) {
            this._commentStore.add({
                author: 'claude',
                text: c.comment,
                item: itemId,
                file: c.file,
                line: c.line,
                block: c.block,
            });
        }
        this.persist();
        return this._commentStore.list({ item: itemId, author: 'claude' }).length;
    }
    getComment(id) {
        return this._commentStore.get(id);
    }
    listComments(filter) {
        return this._commentStore.list(filter);
    }
    updateComment(id, fields) {
        const result = this._commentStore.update(id, fields);
        if (result)
            this.persist();
        return result;
    }
    deleteComment(itemId, commentId) {
        const result = this._commentStore.delete(commentId);
        if (result)
            this.persist();
        return result;
    }
    clearComments(itemId) {
        if (itemId) {
            for (const c of this._commentStore.list({ item: itemId })) {
                this._commentStore.delete(c.id);
            }
        }
        else {
            const all = this._commentStore.list();
            for (const c of all)
                this._commentStore.delete(c.id);
        }
        this.persist();
    }
    // --- User State ---
    get userReviewedFiles() {
        return Array.from(this._reviewedFiles);
    }
    get userSidebarView() {
        return this._sidebarView;
    }
    setUserReviewedFiles(files) {
        this._reviewedFiles = new Set(files);
        this.persist();
    }
    toggleUserReviewedFile(path) {
        const nowReviewed = !this._reviewedFiles.has(path);
        if (nowReviewed)
            this._reviewedFiles.add(path);
        else
            this._reviewedFiles.delete(path);
        this.persist();
        return nowReviewed;
    }
    setUserSidebarView(view) {
        this._sidebarView = view;
        this.persist();
    }
    // --- SSE ---
    subscribe(client) {
        this._sseClients.push(client);
    }
    unsubscribe(client) {
        this._sseClients = this._sseClients.filter(c => c !== client);
    }
    broadcast(event, data) {
        for (const client of this._sseClients) {
            try {
                client.send(event, data);
            }
            catch {
                // client disconnected
            }
        }
    }
    // --- Git watcher ---
    _pollTimer = null;
    _lastIndexMtime = 0;
    _lastHeadContent = '';
    watchRepo() {
        if (this._pollTimer)
            return;
        const gitDir = join(this.repoPath, '.git');
        if (!existsSync(gitDir))
            return;
        const indexPath = join(gitDir, 'index');
        const headPath = join(gitDir, 'HEAD');
        // Snapshot current state
        try {
            this._lastIndexMtime = statSync(indexPath).mtimeMs;
        }
        catch { /* ignore */ }
        try {
            this._lastHeadContent = readFileSync(headPath, 'utf-8');
        }
        catch { /* ignore */ }
        this._pollTimer = setInterval(() => {
            let changed = false;
            try {
                const mtime = statSync(indexPath).mtimeMs;
                if (mtime !== this._lastIndexMtime) {
                    this._lastIndexMtime = mtime;
                    changed = true;
                }
            }
            catch { /* ignore */ }
            try {
                const head = readFileSync(headPath, 'utf-8');
                if (head !== this._lastHeadContent) {
                    this._lastHeadContent = head;
                    changed = true;
                }
            }
            catch { /* ignore */ }
            if (changed && this._sseClients.length > 0) {
                this.broadcast('git_changed', {});
            }
        }, 2000);
    }
    unwatchRepo() {
        if (this._pollTimer)
            clearInterval(this._pollTimer);
        this._pollTimer = null;
    }
}
