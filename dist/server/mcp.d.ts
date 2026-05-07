import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type express from 'express';
import type { SessionManager } from './session-manager.js';
export interface ProjectClaim {
    slug: string;
    sessionId: string;
    claimedAt: string;
}
export declare function getProjectClaim(slug: string): ProjectClaim | null;
export declare function isClaimAlive(slug: string): boolean;
export declare function associateMcpSession(server: McpServer, slug: string): void;
export declare function associateMcpItem(server: McpServer, itemId: string): void;
export declare function notifyChannel(content: string, meta: Record<string, string>): void;
/**
 * Test-only probe: returns the mcp-session-id that currently holds the diff-
 * review claim for the given slug, or null if no session holds it.
 */
export declare function _testing_getDiffClaimHolder(slug: string): string | null;
export declare function mountMcp(app: express.Express, manager: SessionManager): void;
