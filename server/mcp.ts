import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import type express from 'express';
import type { SessionManager } from './session-manager.js';

function createMcpServer(manager: SessionManager): McpServer {
  const server = new McpServer({
    name: 'lgtm',
    version: '0.1.0',
  });

  server.tool(
    'review_start',
    'Register a project for code review and get the browser URL',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
      description: z.string().optional().describe('Review context shown as a banner'),
      baseBranch: z.string().optional().describe('Base branch (auto-detected if omitted)'),
    },
    async ({ repoPath, description, baseBranch }) => {
      const result = manager.register(repoPath, { description, baseBranch });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  server.tool(
    'review_add_document',
    'Add a document tab to a review session',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
      path: z.string().describe('Absolute path to the document file'),
      title: z.string().optional().describe('Tab title (defaults to filename)'),
    },
    async ({ repoPath, path, title }) => {
      const found = manager.findByRepoPath(repoPath);
      if (!found) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Project not registered. Call review_start first.' }) }] };
      }
      const itemTitle = title || path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled';
      const itemId = itemTitle.toLowerCase().replace(/[ /]/g, '-').slice(0, 40);
      const result = found.session.addItem(itemId, itemTitle, path);
      found.session.broadcast('items_changed', { id: itemId });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'review_comment',
    'Add Claude comments to a review item (diff or document)',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
      item: z.string().optional().describe('Item ID to comment on (default: "diff")'),
      comments: z.array(z.object({
        file: z.string().optional().describe('File path within the repo (for diff comments)'),
        line: z.number().optional().describe('Line number (for diff comments)'),
        block: z.number().optional().describe('Block index (for document comments)'),
        comment: z.string().describe('The comment text'),
      })).describe('Array of comments to add'),
    },
    async ({ repoPath, item, comments }) => {
      const found = manager.findByRepoPath(repoPath);
      if (!found) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Project not registered. Call review_start first.' }) }] };
      }
      const itemId = item ?? 'diff';
      const count = found.session.addComments(itemId, comments);
      found.session.broadcast('comments_changed', { item: itemId, count: comments.length });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, count }) }] };
    },
  );

  server.tool(
    'review_status',
    'List all registered review projects and their feedback status',
    {},
    async () => {
      const projects = manager.list().map(p => {
        const session = manager.get(p.slug)!;
        let hasFeedback = false;
        let feedbackRounds = 0;
        try {
          const content = readFileSync(session.outputPath, 'utf-8');
          hasFeedback = content.trim().length > 0;
          const signalPath = session.outputPath + '.signal';
          if (existsSync(signalPath)) {
            feedbackRounds = parseInt(readFileSync(signalPath, 'utf-8').trim()) || 0;
          }
        } catch {
          // file doesn't exist yet
        }
        return { ...p, hasFeedback, feedbackRounds };
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ projects }) }] };
    },
  );

  server.tool(
    'review_read_feedback',
    'Read the submitted review feedback for a project',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
    },
    async ({ repoPath }) => {
      const found = manager.findByRepoPath(repoPath);
      if (!found) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Project not registered. Call review_start first.' }) }] };
      }
      let feedback = '';
      try {
        feedback = readFileSync(found.session.outputPath, 'utf-8');
      } catch {
        // no feedback yet
      }
      return { content: [{ type: 'text' as const, text: feedback || 'No feedback submitted yet.' }] };
    },
  );

  server.tool(
    'review_stop',
    'Deregister a project and stop its review session',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
    },
    async ({ repoPath }) => {
      const found = manager.findByRepoPath(repoPath);
      if (!found) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Project not registered.' }) }] };
      }
      manager.deregister(found.slug);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, slug: found.slug }) }] };
    },
  );

  return server;
}

export function mountMcp(app: express.Express, manager: SessionManager): void {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    const mcpServer = createMcpServer(manager);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) transports.delete(sid);
    };

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);

    if (transport.sessionId) {
      transports.set(transport.sessionId, transport);
    }
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Missing or invalid MCP-Session-Id header' });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      transports.delete(sessionId);
    } else {
      res.status(400).json({ error: 'Missing or invalid MCP-Session-Id header' });
    }
  });
}
