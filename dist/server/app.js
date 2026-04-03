import express, { Router } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFileLines, getBranchCommits, gitRun } from './git-ops.js';
import { slugify } from './slugify.js';
import { notifyChannel } from './mcp.js';
import { findSymbol, sortResults } from './symbol-lookup.js';
export function createApp(manager) {
    const app = express();
    app.use(express.json());
    // --- Top-level project management routes ---
    app.post('/projects', (req, res) => {
        const { repoPath, description, baseBranch } = req.body;
        if (!repoPath) {
            res.status(400).json({ error: 'repoPath is required' });
            return;
        }
        const result = manager.register(repoPath, { description, baseBranch });
        console.log(`PROJECT_REGISTERED=${result.slug} path=${repoPath}`);
        res.json({ ok: true, ...result });
    });
    app.get('/projects', (_req, res) => {
        res.json({ projects: manager.list() });
    });
    app.delete('/projects/:slug', (req, res) => {
        const removed = manager.deregister(req.params.slug);
        if (!removed) {
            res.status(404).json({ error: `Project not found: ${req.params.slug}` });
            return;
        }
        res.json({ ok: true });
    });
    // --- Project-scoped router ---
    const projectRouter = Router({ mergeParams: true });
    projectRouter.use((req, res, next) => {
        const session = manager.get(req.params['slug']);
        if (!session) {
            res.status(404).json({ error: `Project not found: ${req.params.slug}` });
            return;
        }
        res.locals.session = session;
        next();
    });
    // --- GET routes ---
    projectRouter.get('/items', (_req, res) => {
        res.json({ items: res.locals.session.items });
    });
    projectRouter.get('/data', (req, res) => {
        const itemId = req.query.item ?? 'diff';
        const commits = req.query.commits;
        const data = res.locals.session.getItemData(itemId, commits);
        res.json(data);
    });
    projectRouter.get('/context', (req, res) => {
        const session = res.locals.session;
        const file = req.query.file ?? '';
        const line = parseInt(req.query.line) || 0;
        const count = parseInt(req.query.count) || 20;
        const direction = req.query.direction ?? 'down';
        const lines = getFileLines(session.repoPath, file, line, count, direction);
        res.json({ lines });
    });
    projectRouter.get('/file', (req, res) => {
        const session = res.locals.session;
        const filePath = req.query.path ?? '';
        const fullPath = join(session.repoPath, filePath);
        if (!existsSync(fullPath)) {
            res.json({ lines: [] });
            return;
        }
        const content = readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n').map((line, i) => ({
            num: i + 1,
            content: line,
        }));
        res.json({ lines });
    });
    projectRouter.get('/files', (req, res) => {
        const session = res.locals.session;
        const glob = req.query.glob || '**/*.md';
        try {
            const output = gitRun(session.repoPath, 'ls-files', '--', glob);
            const files = output ? output.split('\n').filter(Boolean).sort() : [];
            res.json({ files });
        }
        catch {
            res.json({ files: [] });
        }
    });
    projectRouter.get('/commits', (_req, res) => {
        const session = res.locals.session;
        const commits = getBranchCommits(session.repoPath, session.baseBranch);
        res.json({ commits });
    });
    projectRouter.get('/events', (req, res) => {
        const session = res.locals.session;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        const client = {
            send(event, data) {
                res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            },
        };
        session.subscribe(client);
        const keepalive = setInterval(() => {
            res.write(': keepalive\n\n');
        }, 30_000);
        req.on('close', () => {
            clearInterval(keepalive);
            session.unsubscribe(client);
        });
    });
    projectRouter.get('/analysis', (_req, res) => {
        res.json({ analysis: res.locals.session.analysis });
    });
    projectRouter.get('/symbol', (req, res) => {
        const session = res.locals.session;
        const name = req.query.name ?? '';
        if (!name) {
            res.json({ symbol: '', results: [] });
            return;
        }
        const results = findSymbol(session.repoPath, name);
        const sorted = sortResults(results, new Set());
        res.json({ symbol: name, results: sorted });
    });
    // --- User state routes ---
    projectRouter.get('/user-state', (_req, res) => {
        const session = res.locals.session;
        res.json({
            reviewedFiles: session.userReviewedFiles,
            sidebarView: session.userSidebarView,
        });
    });
    projectRouter.put('/user-state/reviewed', (req, res) => {
        const session = res.locals.session;
        const { path } = req.body;
        if (!path) {
            res.status(400).json({ error: 'path is required' });
            return;
        }
        const reviewed = session.toggleUserReviewedFile(path);
        res.json({ ok: true, reviewed });
    });
    projectRouter.put('/user-state/sidebar-view', (req, res) => {
        const session = res.locals.session;
        const { view } = req.body;
        if (!view || !['flat', 'grouped', 'phased'].includes(view)) {
            res.status(400).json({ error: 'view must be flat, grouped, or phased' });
            return;
        }
        session.setUserSidebarView(view);
        res.json({ ok: true });
    });
    projectRouter.post('/user-state/clear', (_req, res) => {
        const session = res.locals.session;
        session.setUserReviewedFiles([]);
        res.json({ ok: true });
    });
    // --- POST routes ---
    projectRouter.post('/items', (req, res) => {
        const session = res.locals.session;
        const { path: filepath = '', title = '', id = '' } = req.body;
        // Resolve relative paths against the repo root
        const absPath = filepath.startsWith('/') ? filepath : join(session.repoPath, filepath);
        const itemTitle = title || filepath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled';
        const itemId = id || slugify(itemTitle);
        const result = session.addItem(itemId, itemTitle, absPath);
        console.log(`ITEM_ADDED=${itemId}`);
        session.broadcast('items_changed', { id: itemId });
        res.json(result);
    });
    // --- Comment CRUD ---
    projectRouter.get('/comments', (req, res) => {
        const session = res.locals.session;
        const filter = {};
        for (const key of ['item', 'file', 'author', 'parentId', 'mode', 'status']) {
            if (req.query[key])
                filter[key] = req.query[key];
        }
        const comments = session.listComments(Object.keys(filter).length > 0 ? filter : undefined);
        res.json({ comments });
    });
    projectRouter.post('/comments', (req, res) => {
        const session = res.locals.session;
        const { author, text, item, file, line, block, parentId, mode } = req.body;
        if (!author || !text || !item) {
            res.status(400).json({ error: 'author, text, and item are required' });
            return;
        }
        const comment = session.addComment({ author, text, item, file, line, block, parentId, mode });
        session.broadcast('comments_changed', { item, comment });
        // Push direct questions to Claude via channel notification
        if (mode === 'direct' && !parentId) {
            const slug = req.params.slug;
            let content = text;
            if (file && line != null) {
                content = `Question on ${file}:${line}:\n\n${text}`;
                const context = getFileLines(session.repoPath, file, Math.max(1, line - 3), 7);
                if (context.length > 0) {
                    content += `\n\nContext:\n${context.map(l => `${l.num}: ${l.content}`).join('\n')}`;
                }
            }
            const meta = { event: 'question', project: slug, commentId: comment.id };
            if (file)
                meta.file = file;
            if (line != null)
                meta.line = String(line);
            notifyChannel(content, meta);
        }
        res.json({ ok: true, comment });
    });
    projectRouter.patch('/comments/:id', (req, res) => {
        const session = res.locals.session;
        const { text, status } = req.body;
        const updated = session.updateComment(req.params.id, { text, status });
        if (!updated) {
            res.status(404).json({ error: 'Comment not found' });
            return;
        }
        session.broadcast('comments_changed', { item: updated.item, comment: updated });
        res.json({ ok: true, comment: updated });
    });
    projectRouter.delete('/comments/:id', (req, res) => {
        const session = res.locals.session;
        const comment = session.getComment(req.params.id);
        if (!comment) {
            res.status(404).json({ error: 'Comment not found' });
            return;
        }
        session.deleteComment(comment.item, req.params.id);
        session.broadcast('comments_changed', { item: comment.item, deleted: req.params.id });
        res.json({ ok: true });
    });
    projectRouter.post('/submit', async (req, res) => {
        const session = res.locals.session;
        const commentsText = req.body.comments ?? '';
        const item = req.body.item;
        const currentRound = await session.submitReview(commentsText, item);
        console.log(`REVIEW_ROUND=${currentRound}${item ? ` item=${item}` : ''}`);
        // Push review feedback to Claude via channel notification
        const slug = req.params.slug;
        const meta = {
            event: 'review_submitted',
            project: slug,
            round: String(currentRound),
        };
        if (item)
            meta.item = item;
        notifyChannel(commentsText, meta);
        res.json({ ok: true, round: currentRound });
    });
    projectRouter.post('/analysis', (req, res) => {
        const session = res.locals.session;
        session.setAnalysis(req.body);
        console.log(`ANALYSIS_SET files=${Object.keys(req.body.files ?? {}).length}`);
        res.json({ ok: true });
    });
    // --- DELETE routes ---
    projectRouter.delete('/items/:itemId', (req, res) => {
        const session = res.locals.session;
        const removed = session.removeItem(req.params.itemId);
        if (!removed) {
            res.status(404).json({ error: 'Item not found or cannot be removed' });
            return;
        }
        session.broadcast('items_changed', { removed: req.params.itemId });
        res.json({ ok: true });
    });
    // Mount project router
    app.use('/project/:slug', projectRouter);
    // JSON error handler — surfaces git and other errors as { error: message }
    app.use((err, _req, res, _next) => {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    });
    // --- Static files ---
    const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'dist');
    if (existsSync(distDir)) {
        app.use(express.static(distDir));
        // SPA fallback for project URLs
        app.get('/project/{*path}', (_req, res) => {
            res.sendFile(join(distDir, 'index.html'));
        });
    }
    return app;
}
