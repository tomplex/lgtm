import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type express from 'express';
import type { SessionManager } from './session-manager.js';
export declare function associateMcpSession(server: McpServer, slug: string): void;
export declare function associateMcpItem(server: McpServer, itemId: string): void;
export declare function notifyChannel(content: string, meta: Record<string, string>): void;
export declare function mountMcp(app: express.Express, manager: SessionManager): void;
