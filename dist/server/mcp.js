import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { slugify } from './slugify.js';
import { parseFileAnalysis, parseSynthesis } from './parse-analysis.js';
import { parseWalkthrough } from './parse-walkthrough.js';
import { sha256Hex } from './diff-hash.js';
import { getBranchDiff } from './git-ops.js';
function resolveProject(manager, repoPath, mcpServer) {
    let found = manager.findByRepoPath(repoPath);
    if (!found) {
        const { slug } = manager.register(repoPath);
        const session = manager.get(slug);
        found = { slug, session };
    }
    if (mcpServer) {
        associateMcpSession(mcpServer, found.slug);
        autoClaimDiffReviewsIfUnheld(mcpServer, found.slug);
    }
    return { found };
}
function renderFileAnalysisMarkdown(files) {
    const paths = Object.keys(files).sort();
    return paths.map(path => {
        const f = files[path];
        return `## ${path}\n- priority: ${f.priority}\n- phase: ${f.phase}\n- category: ${f.category}\n\n${f.summary}\n`;
    }).join('\n');
}
function createMcpServer(manager) {
    const server = new McpServer({ name: 'lgtm', version: '0.1.0' }, { capabilities: { experimental: { 'claude/channel': {} } } });
    server.tool('add_document', 'Add a document (spec, design doc, markdown file) as a reviewable tab alongside the diff. The user can comment on it in the review UI. Auto-registers the project if needed.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
        path: z.string().describe('Absolute path to the document file'),
        title: z.string().optional().describe('Tab title (defaults to filename)'),
    }, async ({ repoPath, path, title }) => {
        const { found } = resolveProject(manager, repoPath, server);
        const itemTitle = title || path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled';
        const itemId = slugify(itemTitle);
        const result = found.session.addItem(itemId, itemTitle, path);
        found.session.broadcast('items_changed', { id: itemId });
        associateMcpItem(server, itemId);
        console.log(`MCP_ADD_DOCUMENT slug=${found.slug} item=${itemId} title="${itemTitle}" path=${path}`);
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
        const { found } = resolveProject(manager, repoPath, server);
        const itemId = item ?? 'diff';
        const count = found.session.addComments(itemId, comments);
        found.session.broadcast('comments_changed', { item: itemId, count: comments.length });
        console.log(`MCP_COMMENT slug=${found.slug} item=${itemId} count=${count}`);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, count }) }] };
    });
    server.tool('read_feedback', 'Read the review feedback the user submitted via the review UI. Returns markdown-formatted comments with file paths, line numbers, and the user\'s notes. Call this after the user says they submitted a review.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
    }, async ({ repoPath }) => {
        const { found } = resolveProject(manager, repoPath, server);
        let feedback = '';
        try {
            feedback = readFileSync(found.session.outputPath, 'utf-8');
        }
        catch {
            // no feedback yet
        }
        console.log(`MCP_READ_FEEDBACK slug=${found.slug} bytes=${feedback.length}`);
        return { content: [{ type: 'text', text: feedback || 'No feedback submitted yet.' }] };
    });
    server.tool('stop', 'Stop a review session and close it. The review UI will no longer be accessible for this repo.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
    }, async ({ repoPath }) => {
        const found = manager.findByRepoPath(repoPath);
        if (!found) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active review session for this repo path.' }) }] };
        }
        manager.deregister(found.slug);
        console.log(`MCP_STOP slug=${found.slug}`);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, slug: found.slug }) }] };
    });
    server.tool('claim_reviews', 'Claim code review notifications for a project. Auto-registers the project if needed. When the reviewer submits feedback on the diff, only the Claude session that called claim_reviews most recently will receive the notification. Optionally sets a description banner and base branch override. Returns the review URL.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
        description: z.string().optional().describe('Review context shown as a banner in the UI'),
        baseBranch: z.string().optional().describe('Base branch (auto-detected if omitted)'),
    }, async ({ repoPath, description, baseBranch }) => {
        const result = manager.register(repoPath, { description, baseBranch });
        associateMcpSession(server, result.slug);
        claimDiffReviews(server, result.slug);
        console.log(`MCP_CLAIM_REVIEWS slug=${result.slug}${description ? ` description="${description.slice(0, 80)}"` : ''}${baseBranch ? ` base=${baseBranch}` : ''}`);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
    server.tool('reply', 'Reply to a user comment in the review UI. Use this to answer direct questions from the reviewer. The reply appears inline beneath the original comment.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
        commentId: z.string().describe('The ID of the comment to reply to'),
        text: z.string().describe('The reply text'),
    }, async ({ repoPath, commentId, text }) => {
        const { found } = resolveProject(manager, repoPath, server);
        const parent = found.session.getComment(commentId);
        if (!parent) {
            console.log(`MCP_REPLY_FAIL slug=${found.slug} commentId=${commentId} reason=parent_not_found`);
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
        const where = parent.file ? `${parent.file}${parent.line != null ? `:${parent.line}` : ''}` : (parent.block != null ? `block=${parent.block}` : '-');
        console.log(`MCP_REPLY slug=${found.slug} item=${parent.item} parent=${commentId} where=${where} len=${text.length}`);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, id: reply.id }) }] };
    });
    server.tool('set_analysis', 'Set file-level analysis data (priorities, summaries, groupings) from analyzer agent output files. mode="replace" (default) replaces the entire analysis; mode="merge" merges new file entries into the existing analysis, preserving entries not in the new payload (use `removedFiles` for explicit drops). Broadcasts analysis_changed on success.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
        fileAnalysisPath: z.string().describe('Absolute path to the file-analyzer markdown output'),
        synthesisPath: z.string().describe('Absolute path to the synthesis agent markdown output'),
        reviewGuidePath: z.string().optional().describe('Absolute path to a markdown review guide (overview, strategy, opinion) to add as a reviewable document'),
        mode: z.enum(['replace', 'merge']).optional().describe('replace (default) or merge'),
        removedFiles: z.array(z.string()).optional().describe('When mode=merge, paths to drop from the merged result'),
    }, async ({ repoPath, fileAnalysisPath, synthesisPath, reviewGuidePath, mode, removedFiles }) => {
        const { found } = resolveProject(manager, repoPath, server);
        try {
            const fileAnalysisRaw = readFileSync(fileAnalysisPath, 'utf-8');
            const files = fileAnalysisRaw.trim() ? parseFileAnalysis(fileAnalysisRaw) : {};
            const synthesis = parseSynthesis(readFileSync(synthesisPath, 'utf-8'));
            const { blobsByPath } = found.session.getCurrentBlobMap();
            if (mode === 'merge') {
                // Compute the post-merge file set for synthesizedAtFileSet.
                const prev = found.session.analysis?.files ?? {};
                const next = new Set(Object.keys(prev));
                for (const r of removedFiles ?? [])
                    next.delete(r);
                for (const k of Object.keys(files))
                    next.add(k);
                const synthesizedAtFileSet = [...next].sort();
                found.session.mergeAnalysis({
                    files,
                    synthesisIfProvided: { ...synthesis, synthesizedAtFileSet },
                    blobsByPath,
                    removedFiles: removedFiles ?? [],
                });
            }
            else {
                // Replace: stamp blobs on each entry, then setAnalysis.
                const stampedFiles = {};
                for (const [path, entry] of Object.entries(files)) {
                    const blobs = blobsByPath[path];
                    stampedFiles[path] = {
                        ...entry,
                        analyzedAtBaseBlob: blobs?.oldBlob ?? '',
                        analyzedAtHeadBlob: blobs?.newBlob ?? '',
                    };
                }
                found.session.setAnalysis({
                    overview: synthesis.overview,
                    reviewStrategy: synthesis.reviewStrategy,
                    files: stampedFiles,
                    groups: synthesis.groups,
                    synthesizedAtFileSet: Object.keys(stampedFiles).sort(),
                });
            }
            found.session.broadcast('analysis_changed', { mode: mode ?? 'replace' });
            if (reviewGuidePath) {
                found.session.addItem('review-guide', 'Review Guide', reviewGuidePath);
                found.session.broadcast('items_changed', { id: 'review-guide' });
            }
            console.log(`MCP_SET_ANALYSIS slug=${found.slug} mode=${mode ?? 'replace'} files=${Object.keys(files).length} removed=${(removedFiles ?? []).length} groups=${synthesis.groups.length}`);
            return {
                content: [{ type: 'text', text: JSON.stringify({
                            ok: true,
                            fileCount: Object.keys(files).length,
                            removedCount: (removedFiles ?? []).length,
                            groupCount: synthesis.groups.length,
                            reviewGuide: !!reviewGuidePath,
                            mode: mode ?? 'replace',
                        }) }],
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`MCP_SET_ANALYSIS_FAIL slug=${found.slug} error=${msg}`);
            return {
                content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
            };
        }
    });
    server.tool('read_analysis', 'Read the previous analysis for this project, including per-file freshness data. Returns JSON, the file analysis re-rendered as markdown (suitable for passing to file-classifier as prior context), and freshness metadata listing stale/missing/removed files. Used by the /lgtm refresh skill.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
    }, async ({ repoPath }) => {
        const { found } = resolveProject(manager, repoPath, server);
        const result = found.session.getAnalysisWithFreshness();
        if (!result) {
            return { content: [{ type: 'text', text: JSON.stringify({ json: null, markdown: '', freshness: null }) }] };
        }
        const stored = result.analysis;
        const markdown = renderFileAnalysisMarkdown(stored.files ?? {});
        console.log(`MCP_READ_ANALYSIS slug=${found.slug} files=${Object.keys(stored.files ?? {}).length} stale=${result.freshness.staleFiles.length}`);
        return {
            content: [{ type: 'text', text: JSON.stringify({
                        json: result.analysis,
                        markdown,
                        freshness: {
                            staleFiles: result.freshness.staleFiles,
                            missingFiles: result.freshness.missingFiles,
                            removedFiles: result.freshness.removedFiles,
                            staleSynthesis: result.freshness.staleSynthesis,
                            computedAtHead: result.computedAtHead,
                            computedAtBase: result.computedAtBase,
                        },
                    }) }],
        };
    });
    server.tool('set_walkthrough', 'Set the narrated walkthrough for a review session. Accepts a markdown file authored by the walkthrough-author agent. The review UI renders this as an ordered walkthrough of logical changes, separate from the diff view. Called by the walkthrough skill after the agent writes its output.', {
        repoPath: z.string().describe('Absolute path to the git repository'),
        walkthroughPath: z.string().describe('Absolute path to the walkthrough markdown output'),
    }, async ({ repoPath, walkthroughPath }) => {
        const { found } = resolveProject(manager, repoPath, server);
        try {
            const md = readFileSync(walkthroughPath, 'utf-8');
            const parsed = parseWalkthrough(md);
            const diff = getBranchDiff(found.session.repoPath, found.session.baseBranch);
            parsed.diffHash = sha256Hex(diff);
            parsed.generatedAt = new Date().toISOString();
            found.session.setWalkthrough(parsed);
            found.session.broadcast('walkthrough_changed', { stopCount: parsed.stops.length });
            console.log(`MCP_SET_WALKTHROUGH slug=${found.slug} stops=${parsed.stops.length} diffHash=${parsed.diffHash.slice(0, 12)}`);
            return {
                content: [{ type: 'text', text: JSON.stringify({
                            ok: true,
                            stopCount: parsed.stops.length,
                            diffHash: parsed.diffHash,
                        }) }],
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`MCP_SET_WALKTHROUGH_FAIL slug=${found.slug} error=${msg}`);
            return {
                content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
            };
        }
    });
    return server;
}
const activeMcpSessions = new Map();
const projectClaims = new Map(); // keyed by slug
function setProjectClaim(slug, sessionId) {
    projectClaims.set(slug, { slug, sessionId, claimedAt: new Date().toISOString() });
}
function clearProjectClaimsForSession(sessionId) {
    for (const [slug, claim] of projectClaims) {
        if (claim.sessionId === sessionId)
            projectClaims.delete(slug);
    }
}
export function getProjectClaim(slug) {
    return projectClaims.get(slug) ?? null;
}
export function isClaimAlive(slug) {
    const claim = projectClaims.get(slug);
    if (!claim)
        return false;
    return activeMcpSessions.has(claim.sessionId);
}
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
// Claim diff review notifications for this MCP session only if no session holds the claim yet.
// Used by resolveProject so that the first tool caller against a slug gets review notifications
// without silently stealing the claim from another session that already holds it.
function autoClaimDiffReviewsIfUnheld(server, slug) {
    for (const entry of activeMcpSessions.values()) {
        if (entry.projectSlug === slug && entry.claimedDiff)
            return; // someone holds it
    }
    for (const [sid, entry] of activeMcpSessions) {
        if (entry.server === server) {
            entry.claimedDiff = true;
            setProjectClaim(slug, sid);
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
    for (const [sid, entry] of activeMcpSessions) {
        if (entry.server === server) {
            entry.claimedDiff = true;
            setProjectClaim(slug, sid);
            return;
        }
    }
}
export function notifyChannel(content, meta) {
    const targetProject = meta.project;
    const targetItem = meta.item;
    let delivered = 0;
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
        delivered++;
    }
    console.log(`CHANNEL_PUSH project=${targetProject} event=${meta.event ?? '-'} item=${targetItem ?? 'diff'} delivered=${delivered} bytes=${content.length}`);
}
/**
 * Test-only probe: returns the mcp-session-id that currently holds the diff-
 * review claim for the given slug, or null if no session holds it.
 */
export function _testing_getDiffClaimHolder(slug) {
    for (const [sid, entry] of activeMcpSessions) {
        if (entry.projectSlug === slug && entry.claimedDiff)
            return sid;
    }
    return null;
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
            if (sid) {
                clearProjectClaimsForSession(sid);
                activeMcpSessions.delete(sid);
            }
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
