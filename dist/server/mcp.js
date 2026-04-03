import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { slugify } from './slugify.js';
import { parseFileAnalysis, parseSynthesis } from './parse-analysis.js';
function requireProject(manager, repoPath, mcpServer) {
    const found = manager.findByRepoPath(repoPath);
    if (!found) {
        return { error: { content: [{ type: 'text', text: JSON.stringify({ error: 'Project not registered. Call start first.' }) }] } };
    }
    if (mcpServer)
        associateMcpSession(mcpServer, found.slug);
    return { found };
}
function createMcpServer(manager) {
    const server = new McpServer({ name: 'lgtm', version: '0.1.0' }, { capabilities: { experimental: { 'claude/channel': {} } } });
    server.tool('start', 'Start a review session for a git repository. Opens a browser-based UI where the user can review diffs and documents with inline commenting. Returns the URL. Must be called before any other LGTM tools for that repo.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
        description: z.string().optional().describe('Review context shown as a banner'),
        baseBranch: z.string().optional().describe('Base branch (auto-detected if omitted)'),
    }, async ({ repoPath, description, baseBranch }) => {
        const result = manager.register(repoPath, { description, baseBranch });
        associateMcpSession(server, result.slug);
        claimDiffReviews(server, result.slug);
        return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
        };
    });
    server.tool('add_document', 'Add a document (spec, design doc, markdown file) as a reviewable tab alongside the diff. The user can comment on it in the review UI. Requires an active session.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
        path: z.string().describe('Absolute path to the document file'),
        title: z.string().optional().describe('Tab title (defaults to filename)'),
    }, async ({ repoPath, path, title }) => {
        const lookup = requireProject(manager, repoPath, server);
        if ('error' in lookup)
            return lookup.error;
        const { found } = lookup;
        const itemTitle = title || path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled';
        const itemId = slugify(itemTitle);
        const result = found.session.addItem(itemId, itemTitle, path);
        found.session.broadcast('items_changed', { id: itemId });
        associateMcpItem(server, itemId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
    server.tool('comment', 'Add comments from Claude to a review item (diff or document). Comments appear inline in the review UI for the user to reply to, resolve, or dismiss. Use the file+line fields for diff comments, or the block field for document comments.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
        item: z.string().optional().describe('Item ID to comment on (default: "diff")'),
        comments: z.array(z.object({
            file: z.string().optional().describe('File path within the repo (for diff comments)'),
            line: z.number().optional().describe('Line number (for diff comments)'),
            block: z.number().optional().describe('Block index (for document comments)'),
            comment: z.string().describe('The comment text'),
        })).describe('Array of comments to add'),
    }, async ({ repoPath, item, comments }) => {
        const lookup = requireProject(manager, repoPath, server);
        if ('error' in lookup)
            return lookup.error;
        const { found } = lookup;
        const itemId = item ?? 'diff';
        const count = found.session.addComments(itemId, comments);
        found.session.broadcast('comments_changed', { item: itemId, count: comments.length });
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, count }) }] };
    });
    server.tool('read_feedback', 'Read the review feedback the user submitted via the review UI. Returns markdown-formatted comments with file paths, line numbers, and the user\'s notes. Call this after the user says they submitted a review.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
    }, async ({ repoPath }) => {
        const lookup = requireProject(manager, repoPath, server);
        if ('error' in lookup)
            return lookup.error;
        const { found } = lookup;
        let feedback = '';
        try {
            feedback = readFileSync(found.session.outputPath, 'utf-8');
        }
        catch {
            // no feedback yet
        }
        return { content: [{ type: 'text', text: feedback || 'No feedback submitted yet.' }] };
    });
    server.tool('stop', 'Stop a review session and close it. The review UI will no longer be accessible for this repo.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
    }, async ({ repoPath }) => {
        const lookup = requireProject(manager, repoPath, server);
        if ('error' in lookup)
            return lookup.error;
        const { found } = lookup;
        manager.deregister(found.slug);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, slug: found.slug }) }] };
    });
    server.tool('claim_reviews', 'Claim code review notifications for a project. When the reviewer submits feedback on the diff, only the Claude session that claimed reviews will receive the channel notification. Calling this transfers the claim from any previous holder.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
    }, async ({ repoPath }) => {
        const lookup = requireProject(manager, repoPath, server);
        if ('error' in lookup)
            return lookup.error;
        const { found } = lookup;
        claimDiffReviews(server, found.slug);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, slug: found.slug }) }] };
    });
    server.tool('reply', 'Reply to a user comment in the review UI. Use this to answer direct questions from the reviewer. The reply appears inline beneath the original comment.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
        commentId: z.string().describe('The ID of the comment to reply to'),
        text: z.string().describe('The reply text'),
    }, async ({ repoPath, commentId, text }) => {
        const lookup = requireProject(manager, repoPath, server);
        if ('error' in lookup)
            return lookup.error;
        const { found } = lookup;
        const parent = found.session.getComment(commentId);
        if (!parent) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Comment not found: ${commentId}` }) }] };
        }
        const reply = found.session.addComment({
            author: 'claude',
            text,
            parentId: commentId,
            item: parent.item,
            file: parent.file,
            line: parent.line,
            block: parent.block,
        });
        found.session.broadcast('comments_changed', { item: parent.item, comment: reply });
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, id: reply.id }) }] };
    });
    server.tool('set_analysis', 'Set file-level analysis data (priorities, summaries, groupings) from analyzer agent output files. The review UI uses this to show priority indicators, file groupings, and a review strategy. Optionally adds a review guide document. Called by the analyze skill after agents have written their output.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
        fileAnalysisPath: z.string().describe('Absolute path to the file-analyzer markdown output'),
        synthesisPath: z.string().describe('Absolute path to the synthesis agent markdown output'),
        reviewGuidePath: z.string().optional().describe('Absolute path to a markdown review guide (overview, strategy, opinion) to add as a reviewable document'),
    }, async ({ repoPath, fileAnalysisPath, synthesisPath, reviewGuidePath }) => {
        const lookup = requireProject(manager, repoPath, server);
        if ('error' in lookup)
            return lookup.error;
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
            // Add review guide as a reviewable document
            if (reviewGuidePath) {
                found.session.addItem('review-guide', 'Review Guide', reviewGuidePath);
                found.session.broadcast('items_changed', { id: 'review-guide' });
            }
            return {
                content: [{ type: 'text', text: JSON.stringify({
                            ok: true,
                            fileCount: Object.keys(files).length,
                            groupCount: synthesis.groups.length,
                            reviewGuide: !!reviewGuidePath,
                        }) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: JSON.stringify({
                            error: err instanceof Error ? err.message : String(err),
                        }) }],
            };
        }
    });
    return server;
}
const activeMcpSessions = new Map();
// Associate an MCP server instance with a project slug (called when tools use repoPath)
export function associateMcpSession(server, slug) {
    for (const entry of activeMcpSessions.values()) {
        if (entry.server === server) {
            entry.projectSlug = slug;
            return;
        }
    }
}
// Associate an MCP server instance with an item ID (called when add_document is used)
export function associateMcpItem(server, itemId) {
    for (const entry of activeMcpSessions.values()) {
        if (entry.server === server) {
            entry.itemIds.add(itemId);
            return;
        }
    }
}
// Claim diff review notifications for this MCP session (unclaims any previous holder)
function claimDiffReviews(server, slug) {
    for (const entry of activeMcpSessions.values()) {
        if (entry.projectSlug === slug)
            entry.claimedDiff = false;
    }
    for (const entry of activeMcpSessions.values()) {
        if (entry.server === server) {
            entry.claimedDiff = true;
            return;
        }
    }
}
export function notifyChannel(content, meta) {
    const targetProject = meta.project;
    const targetItem = meta.item;
    for (const { server, projectSlug, claimedDiff, itemIds } of activeMcpSessions.values()) {
        // Only notify sessions associated with the target project
        if (!projectSlug || projectSlug !== targetProject)
            continue;
        // Diff reviews go only to the session that claimed them
        if (!targetItem || targetItem === 'diff') {
            if (!claimedDiff)
                continue;
        }
        else {
            // Document reviews go only to the session that added that document
            if (!itemIds.has(targetItem))
                continue;
        }
        server.server.notification({
            method: 'notifications/claude/channel',
            params: { content, meta },
        });
    }
}
export function mountMcp(app, manager) {
    app.post('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'];
        if (sessionId && activeMcpSessions.has(sessionId)) {
            const { transport } = activeMcpSessions.get(sessionId);
            await transport.handleRequest(req, res, req.body);
            return;
        }
        const mcpServer = createMcpServer(manager);
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
        });
        transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid)
                activeMcpSessions.delete(sid);
        };
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
        if (transport.sessionId) {
            activeMcpSessions.set(transport.sessionId, { server: mcpServer, transport, claimedDiff: false, itemIds: new Set() });
        }
    });
    app.get('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'];
        if (!sessionId || !activeMcpSessions.has(sessionId)) {
            res.status(400).json({ error: 'Missing or invalid MCP-Session-Id header' });
            return;
        }
        const { transport } = activeMcpSessions.get(sessionId);
        await transport.handleRequest(req, res);
    });
    app.delete('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'];
        if (sessionId && activeMcpSessions.has(sessionId)) {
            const { transport } = activeMcpSessions.get(sessionId);
            await transport.handleRequest(req, res);
            activeMcpSessions.delete(sessionId);
        }
        else {
            res.status(400).json({ error: 'Missing or invalid MCP-Session-Id header' });
        }
    });
}
