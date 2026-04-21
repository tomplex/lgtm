import { describe, it, expect, vi } from 'vitest';
import { LspClient } from '../../lsp/client.js';
import type { MessageConnection } from 'vscode-jsonrpc/node.js';

function makeFakeConnection(overrides: Partial<MessageConnection> = {}): MessageConnection {
  const handlers = new Map<string, (params: unknown) => void>();
  const listen = vi.fn();
  const sendRequest = vi.fn(async (method: string) => {
    if (method === 'initialize') {
      return { capabilities: {} };
    }
    return null;
  });
  const sendNotification = vi.fn();
  const onNotification = vi.fn((method: string, handler: (params: unknown) => void) => {
    handlers.set(method, handler);
    return { dispose: () => handlers.delete(method) };
  });
  const dispose = vi.fn();
  const onClose = vi.fn();
  return {
    listen,
    sendRequest,
    sendNotification,
    onNotification,
    dispose,
    onClose,
    ...overrides,
  } as unknown as MessageConnection;
}

describe('LspClient', () => {
  it('sends initialize + initialized, transitions to ready (non-rust)', async () => {
    const conn = makeFakeConnection();
    const client = new LspClient({
      language: 'python',
      projectPath: '/tmp/proj',
      connection: conn,
      stderrLines: 10,
    });
    await client.initialize();
    expect((conn.sendRequest as any).mock.calls[0][0]).toBe('initialize');
    expect((conn.sendNotification as any).mock.calls[0][0]).toBe('initialized');
    expect(client.state).toBe('ready');
  });

  it('shutdown sends shutdown + exit and disposes', async () => {
    const conn = makeFakeConnection();
    const client = new LspClient({
      language: 'python',
      projectPath: '/tmp/proj',
      connection: conn,
      stderrLines: 10,
    });
    await client.initialize();
    await client.shutdown();
    const methods = (conn.sendRequest as any).mock.calls.map((c: any[]) => c[0]);
    expect(methods).toContain('shutdown');
    const notifs = (conn.sendNotification as any).mock.calls.map((c: any[]) => c[0]);
    expect(notifs).toContain('exit');
    expect(client.state).toBe('shuttingDown');
  });
});
