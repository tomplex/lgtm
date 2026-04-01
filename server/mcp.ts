import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import type express from 'express';
import type { SessionManager } from './session-manager.js';
import { slugify } from './slugify.js';
import { parseFileAnalysis, parseSynthesis } from './parse-analysis.js';

type McpTextResult = { content: [{ type: 'text'; text: string }] };

function requireProject(manager: SessionManager, repoPath: string): { found: ReturnType<SessionManager['findByRepoPath']> & object } | { error: McpTextResult } {
  const found = manager.findByRepoPath(repoPath);
  if (!found) {
    return { error: { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Project not registered. Call start first.' }) }] } };
  }
  return { found };
}

function createMcpServer(manager: SessionManager): McpServer {
  const server = new McpServer({
    name: 'lgtm',
    version: '0.1.0',
  });

  server.tool(
    'start',
    'Start a review session for a git repository. Opens a browser-based UI where the user can review diffs and documents with inline commenting. Returns the URL. Must be called before any other LGTM tools for that repo.',
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
    'add_document',
    'Add a document (spec, design doc, markdown file) as a reviewable tab alongside the diff. The user can comment on it in the review UI. Requires an active session.',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
      path: z.string().describe('Absolute path to the document file'),
      title: z.string().optional().describe('Tab title (defaults to filename)'),
    },
    async ({ repoPath, path, title }) => {
      const lookup = requireProject(manager, repoPath);
      if ('error' in lookup) return lookup.error;
      const { found } = lookup;
      const itemTitle = title || path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled';
      const itemId = slugify(itemTitle);
      const result = found.session.addItem(itemId, itemTitle, path);
      found.session.broadcast('items_changed', { id: itemId });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'comment',
    'Add comments from Claude to a review item (diff or document). Comments appear inline in the review UI for the user to reply to, resolve, or dismiss. Use the file+line fields for diff comments, or the block field for document comments.',
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
      const lookup = requireProject(manager, repoPath);
      if ('error' in lookup) return lookup.error;
      const { found } = lookup;
      const itemId = item ?? 'diff';
      const count = found.session.addComments(itemId, comments);
      found.session.broadcast('comments_changed', { item: itemId, count: comments.length });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, count }) }] };
    },
  );

  server.tool(
    'status',
    'List active review sessions and whether the user has submitted feedback. Use this to check if a session exists before calling other tools, or to poll for new feedback.',
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
    'read_feedback',
    'Read the review feedback the user submitted via the review UI. Returns markdown-formatted comments with file paths, line numbers, and the user\'s notes. Call this after the user says they submitted a review.',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
    },
    async ({ repoPath }) => {
      const lookup = requireProject(manager, repoPath);
      if ('error' in lookup) return lookup.error;
      const { found } = lookup;
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
    'stop',
    'Stop a review session and close it. The review UI will no longer be accessible for this repo.',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
    },
    async ({ repoPath }) => {
      const lookup = requireProject(manager, repoPath);
      if ('error' in lookup) return lookup.error;
      const { found } = lookup;
      manager.deregister(found.slug);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, slug: found.slug }) }] };
    },
  );

  server.tool(
    'set_analysis',
    'Set file-level analysis data (priorities, summaries, groupings) from analyzer agent output files. The review UI uses this to show priority indicators, file groupings, and a review strategy. Called by the analyze skill after agents have written their output.',
    {
      repoPath: z.string().describe('Absolute path to the git repository'),
      fileAnalysisPath: z.string().describe('Absolute path to the file-analyzer markdown output'),
      synthesisPath: z.string().describe('Absolute path to the synthesis agent markdown output'),
    },
    async ({ repoPath, fileAnalysisPath, synthesisPath }) => {
      const lookup = requireProject(manager, repoPath);
      if ('error' in lookup) return lookup.error;
      const { found } = lookup;

      try {
        const files = parseFileAnalysis(readFileSync(fileAnalysisPath, 'utf-8'));
        const synthesis = parseSynthesis(readFileSync(synthesisPath, 'utf-8'));

        const analysis = {
          overview: synthesis.overview,
          reviewStrategy: synthesis.reviewStrategy,
          files,
          groups: synthesis.groups,
        };

        found.session.setAnalysis(analysis);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            ok: true,
            fileCount: Object.keys(files).length,
            groupCount: synthesis.groups.length,
          }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }) }],
        };
      }
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
