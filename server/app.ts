import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFileLines, getBranchCommits } from './git-ops.js';
import { type Session, type SSEClient } from './session.js';

export function createApp(session: Session): express.Express {
  const app = express();
  app.use(express.json());

  // --- GET routes ---

  app.get('/items', (_req, res) => {
    res.json({ items: session.items });
  });

  app.get('/data', (req, res) => {
    const itemId = (req.query.item as string) ?? 'diff';
    const commits = req.query.commits as string | undefined;
    const data = session.getItemData(itemId, commits);
    res.json(data);
  });

  app.get('/context', (req, res) => {
    const file = (req.query.file as string) ?? '';
    const line = parseInt(req.query.line as string) || 0;
    const count = parseInt(req.query.count as string) || 20;
    const direction = (req.query.direction as string) ?? 'down';
    const lines = getFileLines(session.repoPath, file, line, count, direction);
    res.json({ lines });
  });

  app.get('/file', (req, res) => {
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

  app.get('/commits', (_req, res) => {
    const commits = getBranchCommits(session.repoPath, session.baseBranch);
    res.json({ commits });
  });

  app.get('/events', (req, res) => {
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

  app.get('/analysis', (_req, res) => {
    res.json({ analysis: session.analysis });
  });

  // --- POST routes ---

  app.post('/items', (req, res) => {
    const { path: filepath = '', title = '', id = '' } = req.body;
    const itemTitle = title || filepath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled';
    const itemId = id || slugify(itemTitle);
    const result = session.addItem(itemId, itemTitle, filepath);
    console.log(`ITEM_ADDED=${itemId}`);
    session.broadcast('items_changed', { id: itemId });
    res.json(result);
  });

  app.post('/comments', (req, res) => {
    const itemId = req.body.item ?? 'diff';
    const newComments = req.body.comments ?? [];
    const count = session.addComments(itemId, newComments);
    console.log(`CLAUDE_COMMENTS_ADDED=${newComments.length} item=${itemId}`);
    session.broadcast('comments_changed', { item: itemId, count: newComments.length });
    res.json({ ok: true, count });
  });

  app.post('/submit', (req, res) => {
    const commentsText = req.body.comments ?? '';
    const currentRound = session.submitReview(commentsText);
    console.log(`REVIEW_ROUND=${currentRound}`);
    res.json({ ok: true, round: currentRound });
  });

  app.post('/analysis', (req, res) => {
    session.setAnalysis(req.body);
    console.log(`ANALYSIS_SET files=${Object.keys(req.body.files ?? {}).length}`);
    res.json({ ok: true });
  });

  // --- DELETE routes ---

  app.delete('/comments', (req, res) => {
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

  // --- Static files (must be last) ---

  const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'dist');
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(join(distDir, 'index.html'));
    });
  }

  return app;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[ /]/g, '-').slice(0, 40);
}
