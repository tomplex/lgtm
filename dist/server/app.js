import express, { Router } from 'express';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative as pathRelative, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFileLines, getBranchCommits, getBranchDiff, gitRun, getRepoMeta } from './git-ops.js';
import { sha256Hex } from './diff-hash.js';
import { slugify } from './slugify.js';
import { notifyChannel } from './mcp.js';
import { findSymbol, sortResults, extractPythonBody, extractTypeScriptBody, extractPythonDocstring, extractJsDocstring, detectKind, } from './symbol-lookup.js';
import { extensionToLanguage, getLanguageConfig } from './lsp/index.js';
import { fromFileUri } from './lsp/uri.js';
import { detectLanguagesInRepo, getInstaller, isInstallerAvailable, runInstaller, } from './lsp/bootstrap.js';
/**
 * LSP hover content comes back as markdown. For TS / Rust / Python, common shapes are:
 *   1. Single fenced block (typescript-language-server): ```ts\nsig\n```
 *   2. Fenced block + docs:                              ```ts\nsig\n```\n\ndocs...
 *   3. Fenced block + --- + docs (ty / some TS setups)
 *   4. Multiple fenced blocks (rust-analyzer)
 *   5. Plain text
 *
 * The goal here is to return a clean `signature` (no fences) and optional `docs`,
 * without relying on a fragile single-shot regex.
 */
function parseHover(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return {};
    const signatureLines = [];
    const docsLines = [];
    let stage = 'before-fence';
    for (const line of trimmed.split('\n')) {
        if (stage === 'before-fence') {
            if (line.startsWith('```')) {
                stage = 'in-fence';
            }
            else {
                signatureLines.push(line);
            }
        }
        else if (stage === 'in-fence') {
            if (line.startsWith('```')) {
                stage = 'after-fence';
            }
            else {
                signatureLines.push(line);
            }
        }
        else {
            if (line.startsWith('```'))
                continue; // drop further fences
            if (/^-{3,}\s*$/.test(line))
                continue; // drop --- separators
            docsLines.push(line);
        }
    }
    const signature = signatureLines.join('\n').trim() || undefined;
    const docs = docsLines.join('\n').trim() || undefined;
    return { signature, docs };
}
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
    app.get('/projects', async (_req, res) => {
        const projects = await Promise.all(manager.list().map(async (p) => {
            const session = manager.get(p.slug);
            let branch = null;
            let baseBranch = session.baseBranch;
            let pr = null;
            let repoName = basename(p.repoPath);
            try {
                const meta = await session.getCachedMeta();
                branch = meta.branch;
                baseBranch = meta.baseBranch;
                repoName = meta.repoName;
                if (meta.pr)
                    pr = { number: meta.pr.number, url: meta.pr.url };
            }
            catch {
                // repo missing or git failed — branch stays null
            }
            const topLevel = session
                .listComments()
                .filter((c) => c.parentId == null && c.status !== 'dismissed');
            const claudeCommentCount = topLevel.filter((c) => c.author === 'claude').length;
            const userCommentCount = topLevel.filter((c) => c.author === 'user').length;
            return { ...p, repoName, branch, baseBranch, pr, claudeCommentCount, userCommentCount };
        }));
        res.json({ projects });
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
    projectRouter.get('/walkthrough', (_req, res) => {
        const session = res.locals.session;
        const wt = session.walkthrough;
        if (!wt) {
            res.json({ walkthrough: null, stale: false });
            return;
        }
        const currentDiff = getBranchDiff(session.repoPath, session.baseBranch);
        const currentHash = sha256Hex(currentDiff);
        res.json({ walkthrough: wt, stale: currentHash !== wt.diffHash });
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
    projectRouter.get('/definition', async (req, res) => {
        const session = res.locals.session;
        const file = req.query.file ?? '';
        const line = parseInt(req.query.line ?? '-1', 10);
        const character = parseInt(req.query.character ?? '-1', 10);
        if (!file || line < 0 || character < 0) {
            res.status(400).json({ error: 'file, line, character required' });
            return;
        }
        const language = extensionToLanguage(file);
        const absPath = pathResolve(session.repoPath, file);
        const fallback = () => {
            let name = '';
            try {
                const content = readFileSync(absPath, 'utf8');
                const lines = content.split('\n');
                const l = lines[line] ?? '';
                let s = character;
                let e = character;
                while (s > 0 && /[\w]/.test(l[s - 1]))
                    s--;
                while (e < l.length && /[\w]/.test(l[e]))
                    e++;
                name = l.slice(s, e);
            }
            catch { /* ignore */ }
            if (!name)
                return { symbol: '', results: [] };
            const results = findSymbol(session.repoPath, name);
            return { symbol: name, results: sortResults(results, new Set([file])) };
        };
        if (!language) {
            res.json({ status: 'fallback', result: fallback() });
            return;
        }
        const client = await session.lsp.get(language);
        if (!client) {
            res.json({ status: 'missing', result: fallback() });
            return;
        }
        const cfg = getLanguageConfig(language);
        if (cfg.requiresOpen)
            await client.openFile(absPath);
        try {
            const locs = await client.definition(absPath, { line, character });
            if (locs.length === 0) {
                res.json({ status: 'ok', result: { symbol: '', results: [] } });
                return;
            }
            const results = [];
            for (const loc of locs) {
                const targetPath = fromFileUri(loc.uri);
                let content;
                try {
                    content = readFileSync(targetPath, 'utf8');
                }
                catch {
                    continue;
                }
                const lines = content.split('\n');
                const startLine = loc.range.start.line;
                const lineText = lines[startLine] ?? '';
                const kind = detectKind(lineText);
                const body = targetPath.endsWith('.py')
                    ? extractPythonBody(lines, startLine)
                    : extractTypeScriptBody(lines, startLine);
                const docstring = targetPath.endsWith('.py')
                    ? extractPythonDocstring(lines, startLine)
                    : extractJsDocstring(lines, startLine);
                const relative = pathRelative(session.repoPath, targetPath) || targetPath;
                results.push({ file: relative, line: startLine + 1, kind, body, docstring });
            }
            res.json({ status: 'ok', result: { symbol: '', results } });
        }
        catch (err) {
            console.log(`LSP_DEFINITION_FAIL language=${language} error=${err.message}`);
            res.json({ status: 'fallback', result: fallback() });
        }
    });
    projectRouter.get('/hover', async (req, res) => {
        const session = res.locals.session;
        const file = req.query.file ?? '';
        const line = parseInt(req.query.line ?? '-1', 10);
        const character = parseInt(req.query.character ?? '-1', 10);
        if (!file || line < 0 || character < 0) {
            res.status(400).json({ error: 'file, line, character required' });
            return;
        }
        const language = extensionToLanguage(file);
        if (!language) {
            res.json({ status: 'missing', result: {} });
            return;
        }
        const client = await session.lsp.get(language);
        if (!client) {
            res.json({ status: 'missing', result: {} });
            return;
        }
        const absPath = pathResolve(session.repoPath, file);
        const cfg = getLanguageConfig(language);
        if (cfg.requiresOpen)
            await client.openFile(absPath);
        try {
            const raw = await client.hover(absPath, { line, character });
            if (!raw) {
                res.json({ status: 'ok', result: {} });
                return;
            }
            res.json({ status: 'ok', result: parseHover(raw) });
        }
        catch (err) {
            console.log(`LSP_HOVER_FAIL language=${language} error=${err.message}`);
            res.json({ status: 'fallback', result: {} });
        }
    });
    projectRouter.get('/references', async (req, res) => {
        const session = res.locals.session;
        const file = req.query.file ?? '';
        const line = parseInt(req.query.line ?? '-1', 10);
        const character = parseInt(req.query.character ?? '-1', 10);
        if (!file || line < 0 || character < 0) {
            res.status(400).json({ error: 'file, line, character required' });
            return;
        }
        const language = extensionToLanguage(file);
        if (!language) {
            res.json({ status: 'missing', result: { references: [] } });
            return;
        }
        const client = await session.lsp.get(language);
        if (!client) {
            res.json({ status: 'missing', result: { references: [] } });
            return;
        }
        const absPath = pathResolve(session.repoPath, file);
        const cfg = getLanguageConfig(language);
        if (cfg.requiresOpen)
            await client.openFile(absPath);
        try {
            const locs = await client.references(absPath, { line, character });
            const references = locs.map((loc) => {
                const target = fromFileUri(loc.uri);
                let snippet = '';
                try {
                    const lines = readFileSync(target, 'utf8').split('\n');
                    snippet = (lines[loc.range.start.line] ?? '').trim();
                }
                catch { /* ignore */ }
                const rel = pathRelative(session.repoPath, target) || target;
                return { file: rel, line: loc.range.start.line + 1, snippet };
            });
            res.json({ status: 'ok', result: { references } });
        }
        catch (err) {
            console.log(`LSP_REFERENCES_FAIL language=${language} error=${err.message}`);
            res.json({ status: 'fallback', result: { references: [] } });
        }
    });
    projectRouter.get('/lsp/state', (_req, res) => {
        const session = res.locals.session;
        res.json({
            python: session.lsp.status('python'),
            typescript: session.lsp.status('typescript'),
            rust: session.lsp.status('rust'),
        });
    });
    projectRouter.post('/lsp/warm', (req, res) => {
        const session = res.locals.session;
        const requested = Array.isArray(req.body?.languages) ? req.body.languages : [];
        const languages = requested.filter((l) => l === 'python' || l === 'typescript' || l === 'rust');
        for (const lang of languages) {
            session.lsp.get(lang).catch(() => {
                // get() already records 'missing' state; nothing to do here
            });
        }
        res.json({
            warmed: languages,
            state: {
                python: session.lsp.status('python'),
                typescript: session.lsp.status('typescript'),
                rust: session.lsp.status('rust'),
            },
        });
    });
    projectRouter.get('/lsp/bootstrap', async (_req, res) => {
        const session = res.locals.session;
        const present = detectLanguagesInRepo(session.repoPath);
        const langs = ['python', 'typescript', 'rust'];
        const plan = await Promise.all(langs.map(async (language) => {
            const inst = getInstaller(language);
            return {
                language,
                presentInRepo: present.has(language),
                status: session.lsp.status(language),
                installer: inst.installer,
                installCommand: inst.displayCommand,
                installerAvailable: await isInstallerAvailable(inst.installer),
            };
        }));
        res.json({ plan });
    });
    projectRouter.post('/lsp/bootstrap', async (req, res) => {
        const session = res.locals.session;
        const requested = Array.isArray(req.body?.languages) ? req.body.languages : [];
        const languages = requested.filter((l) => l === 'python' || l === 'typescript' || l === 'rust');
        if (languages.length === 0) {
            res.status(400).json({ error: 'languages must be a non-empty list of python|typescript|rust' });
            return;
        }
        const results = [];
        for (const language of languages) {
            console.log(`LSP_BOOTSTRAP_INSTALL language=${language}`);
            const result = await runInstaller(language);
            console.log(`LSP_BOOTSTRAP_DONE language=${language} ok=${result.ok} exit=${result.exitCode}`);
            if (result.ok) {
                // A successful install means a previously cached 'missing' verdict is stale.
                session.lsp.resetKnown(language);
                // Kick off startup so the badge transitions out of 'missing' on its own.
                session.lsp.get(language).catch(() => { });
            }
            results.push(result);
        }
        res.json({ results });
    });
    projectRouter.get('/lsp/debug', async (_req, res) => {
        const session = res.locals.session;
        const result = {};
        for (const lang of ['python', 'typescript', 'rust']) {
            const client = await session.lsp.get(lang).catch(() => null);
            if (!client) {
                result[lang] = { state: 'missing' };
            }
            else {
                result[lang] = {
                    state: client.state ?? 'unknown',
                    stderr: client.stderrRing ?? [],
                    openFiles: client.openFiles?.() ?? [],
                };
            }
        }
        res.json(result);
    });
    projectRouter.delete('/lsp/request', async (req, res) => {
        const session = res.locals.session;
        const method = req.query.method;
        const file = req.query.file ?? '';
        const line = parseInt(req.query.line ?? '-1', 10);
        const character = parseInt(req.query.character ?? '-1', 10);
        if (!['definition', 'hover', 'references'].includes(method) || !file || line < 0 || character < 0) {
            res.status(400).json({ error: 'method, file, line, character required' });
            return;
        }
        const language = extensionToLanguage(file);
        if (!language) {
            res.json({ ok: true });
            return;
        }
        const client = await session.lsp.get(language);
        if (!client) {
            res.json({ ok: true });
            return;
        }
        const absPath = pathResolve(session.repoPath, file);
        client
            .cancel(method, absPath, { line, character });
        res.json({ ok: true });
    });
    // --- User state routes ---
    projectRouter.get('/user-state', (_req, res) => {
        const session = res.locals.session;
        res.json({
            reviewedFiles: session.userReviewedFiles,
            ...session.userSidebarPrefs,
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
    projectRouter.put('/user-state/sidebar-prefs', (req, res) => {
        const session = res.locals.session;
        const prefs = {};
        const { sortMode, groupMode, groupModeUserTouched, collapsedFolders } = req.body ?? {};
        if (sortMode !== undefined) {
            if (sortMode !== 'path' && sortMode !== 'priority') {
                res.status(400).json({ error: 'sortMode must be path or priority' });
                return;
            }
            prefs.sortMode = sortMode;
        }
        if (groupMode !== undefined) {
            if (groupMode !== 'none' && groupMode !== 'phase') {
                res.status(400).json({ error: 'groupMode must be none or phase' });
                return;
            }
            prefs.groupMode = groupMode;
        }
        if (groupModeUserTouched !== undefined) {
            if (typeof groupModeUserTouched !== 'boolean') {
                res.status(400).json({ error: 'groupModeUserTouched must be boolean' });
                return;
            }
            prefs.groupModeUserTouched = groupModeUserTouched;
        }
        if (collapsedFolders !== undefined) {
            if (typeof collapsedFolders !== 'object' || collapsedFolders === null || Array.isArray(collapsedFolders)) {
                res.status(400).json({ error: 'collapsedFolders must be an object' });
                return;
            }
            for (const [key, value] of Object.entries(collapsedFolders)) {
                if (typeof value !== 'boolean') {
                    res.status(400).json({ error: `collapsedFolders values must be boolean, got ${typeof value} for key "${key}"` });
                    return;
                }
            }
            prefs.collapsedFolders = collapsedFolders;
        }
        session.setUserSidebarPrefs(prefs);
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
        const { author, text, item, file, line, side, block, parentId, mode } = req.body;
        if (!author || !text || !item) {
            res.status(400).json({ error: 'author, text, and item are required' });
            return;
        }
        const comment = session.addComment({ author, text, item, file, line, side, block, parentId, mode });
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
    projectRouter.post('/submit-github', (req, res) => {
        const session = res.locals.session;
        const meta = getRepoMeta(session.repoPath, session.baseBranch);
        if (!meta.pr) {
            res.status(400).json({ error: 'No PR detected for this project' });
            return;
        }
        const { event = 'COMMENT', body = '' } = req.body;
        if (!['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(event)) {
            res.status(400).json({ error: 'event must be COMMENT, APPROVE, or REQUEST_CHANGES' });
            return;
        }
        // Collect active diff review comments (top-level only)
        const topComments = session.listComments({
            item: 'diff',
            author: 'user',
            mode: 'review',
            status: 'active',
        }).filter(c => !c.parentId && c.file && c.line != null);
        // Flatten reply threads into parent comment body
        const allComments = session.listComments({ item: 'diff' });
        const ghComments = topComments.map(c => {
            const replies = allComments
                .filter(r => r.parentId === c.id)
                .map(r => r.text);
            const fullText = replies.length > 0
                ? c.text + '\n\n' + replies.join('\n\n')
                : c.text;
            return {
                path: c.file,
                line: c.line,
                side: c.side ?? 'RIGHT',
                body: fullText,
            };
        });
        const payload = JSON.stringify({
            event,
            body: body || 'Review submitted via LGTM',
            comments: ghComments,
        });
        try {
            const result = execFileSync('gh', [
                'api',
                `repos/${meta.pr.owner}/${meta.pr.repo}/pulls/${meta.pr.number}/reviews`,
                '--method', 'POST',
                '--input', '-',
            ], {
                cwd: session.repoPath,
                encoding: 'utf-8',
                input: payload,
                timeout: 15000,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const review = JSON.parse(result);
            res.json({ ok: true, reviewUrl: review.html_url });
        }
        catch (e) {
            const msg = e.stderr?.trim() || e.message || 'GitHub API call failed';
            res.status(502).json({ error: msg });
        }
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
