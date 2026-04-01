import express, { type Request, type Response, type NextFunction, Router } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFileLines, getBranchCommits } from './git-ops.js';
import { type Session, type SSEClient } from './session.js';
import { type SessionManager } from './session-manager.js';
import { slugify } from './slugify.js';

declare global {
  namespace Express {
    interface Locals {
      session: Session;
    }
  }
}

export function createApp(manager: SessionManager): express.Express {
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

  projectRouter.use((req: Request, res: Response, next: NextFunction) => {
    const session = manager.get(req.params['slug'] as string);
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
    const itemId = (req.query.item as string) ?? 'diff';
    const commits = req.query.commits as string | undefined;
    const data = res.locals.session.getItemData(itemId, commits);
    res.json(data);
  });

  projectRouter.get('/context', (req, res) => {
    const session = res.locals.session;
    const file = (req.query.file as string) ?? '';
    const line = parseInt(req.query.line as string) || 0;
    const count = parseInt(req.query.count as string) || 20;
    const direction = (req.query.direction as string) ?? 'down';
    const lines = getFileLines(session.repoPath, file, line, count, direction);
    res.json({ lines });
  });

  projectRouter.get('/file', (req, res) => {
    const session = res.locals.session;
    const filePath = (req.query.path as string) ?? '';
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

    const client: SSEClient = {
      send(event: string, data: unknown) {
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

  // --- POST routes ---

  projectRouter.post('/items', (req, res) => {
    const session = res.locals.session;
    const { path: filepath = '', title = '', id = '' } = req.body;
    const itemTitle = title || filepath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled';
    const itemId = id || slugify(itemTitle);
    const result = session.addItem(itemId, itemTitle, filepath);
    console.log(`ITEM_ADDED=${itemId}`);
    session.broadcast('items_changed', { id: itemId });
    res.json(result);
  });

  projectRouter.post('/comments', (req, res) => {
    const session = res.locals.session;
    const itemId = req.body.item ?? 'diff';
    const newComments = req.body.comments ?? [];
    const count = session.addComments(itemId, newComments);
    console.log(`CLAUDE_COMMENTS_ADDED=${newComments.length} item=${itemId}`);
    session.broadcast('comments_changed', { item: itemId, count: newComments.length });
    res.json({ ok: true, count });
  });

  projectRouter.post('/submit', async (req, res) => {
    const session = res.locals.session;
    const commentsText = req.body.comments ?? '';
    const currentRound = await session.submitReview(commentsText);
    console.log(`REVIEW_ROUND=${currentRound}`);
    res.json({ ok: true, round: currentRound });
  });

  projectRouter.post('/analysis', (req, res) => {
    const session = res.locals.session;
    session.setAnalysis(req.body);
    console.log(`ANALYSIS_SET files=${Object.keys(req.body.files ?? {}).length}`);
    res.json({ ok: true });
  });

  // --- DELETE routes ---

  projectRouter.delete('/comments', (req, res) => {
    const session = res.locals.session;
    const itemId = req.query.item as string | undefined;
    const index = req.query.index as string | undefined;
    if (itemId && index) {
      session.deleteComment(itemId, parseInt(index));
    } else if (itemId) {
      session.clearComments(itemId);
    } else {
      session.clearComments();
    }
    res.json({ ok: true });
  });

  // Mount project router
  app.use('/project/:slug', projectRouter);

  // JSON error handler — surfaces git and other errors as { error: message }
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
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

