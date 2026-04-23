import request from 'supertest';
import type express from 'express';

export interface McpClient {
  sessionId: string;
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>;
  close: () => Promise<void>;
}

export interface McpToolResult {
  /** Parsed JSON payload from the tool's first text content, if parseable. */
  json?: unknown;
  /** Raw text payload from the tool's first text content. */
  text?: string;
  /** The full JSON-RPC response body. */
  raw: unknown;
  /** JSON-RPC error message, if the call errored. */
  error?: string;
}

/**
 * Parse a response body that may be either JSON or SSE. The streamable HTTP
 * transport can return either depending on the request. For tools that don't
 * stream, we expect a single `message` SSE event or a JSON body.
 */
function parseBody(res: request.Response): unknown {
  if (res.body && Object.keys(res.body).length > 0) return res.body;
  const text = res.text ?? '';
  // SSE frames look like: "event: message\ndata: {...}\n\n"
  const dataLines = text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length));
  if (dataLines.length === 0) return null;
  // Use the last data frame (the tool result)
  try {
    return JSON.parse(dataLines[dataLines.length - 1]);
  } catch {
    return null;
  }
}

export async function createMcpClient(app: express.Express): Promise<McpClient> {
  const init = await request(app)
    .post('/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'lgtm-test', version: '0.0.0' },
      },
    });
  const sessionId = init.headers['mcp-session-id'] as string | undefined;
  if (!sessionId) {
    throw new Error(`MCP initialize failed (status ${init.status}): ${init.text || JSON.stringify(init.body)}`);
  }

  await request(app)
    .post('/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('mcp-session-id', sessionId)
    .send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  let nextId = 2;
  const callTool = async (name: string, args: Record<string, unknown>): Promise<McpToolResult> => {
    const res = await request(app)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('mcp-session-id', sessionId)
      .send({
        jsonrpc: '2.0',
        id: nextId++,
        method: 'tools/call',
        params: { name, arguments: args },
      });
    const raw = parseBody(res);
    const rpc = raw as {
      result?: { content?: Array<{ type: string; text?: string }> };
      error?: { message?: string };
    } | null;
    if (rpc?.error?.message) return { raw, error: rpc.error.message };
    const text = rpc?.result?.content?.[0]?.text;
    if (typeof text !== 'string') return { raw };
    try {
      return { raw, text, json: JSON.parse(text) };
    } catch {
      return { raw, text };
    }
  };

  const close = async () => {
    await request(app).delete('/mcp').set('mcp-session-id', sessionId);
  };

  return { sessionId, callTool, close };
}
