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

describe('LspClient rust-analyzer quiescent wait', () => {
  it('stays indexing until experimental/serverStatus quiescent arrives', async () => {
    let statusHandler: ((p: unknown) => void) | null = null;
    const conn = makeFakeConnection({
      onNotification: ((method: string, handler: (p: unknown) => void) => {
        if (method === 'experimental/serverStatus') statusHandler = handler;
        return { dispose: () => {} };
      }) as any,
    });
    const client = new LspClient({
      language: 'rust',
      projectPath: '/tmp/proj',
      connection: conn,
      stderrLines: 10,
    });
    const ready = client.waitReady(1000);
    await client.initialize();
    expect(client.state).toBe('indexing');
    statusHandler!({ quiescent: false, health: 'ok', message: 'Building' });
    expect(client.state).toBe('indexing');
    statusHandler!({ quiescent: true, health: 'ok', message: 'Done' });
    await ready;
    expect(client.state).toBe('ready');
  });

  it('non-rust language resolves waitReady immediately', async () => {
    const conn = makeFakeConnection();
    const client = new LspClient({
      language: 'python',
      projectPath: '/tmp/proj',
      connection: conn,
      stderrLines: 10,
    });
    await client.initialize();
    await client.waitReady(1000);
    expect(client.state).toBe('ready');
  });
});
