import { describe, it, expect, vi } from 'vitest';
import { LspManager } from '../../lsp/manager.js';
import { LspClient } from '../../lsp/client.js';
import type { MessageConnection } from 'vscode-jsonrpc/node.js';

function makeFakeConnection(): MessageConnection {
  return {
    listen: vi.fn(),
    sendRequest: vi.fn(async () => ({ capabilities: {} })),
    sendNotification: vi.fn(),
    onNotification: vi.fn(() => ({ dispose: () => {} })),
    dispose: vi.fn(),
    onClose: vi.fn(),
  } as unknown as MessageConnection;
}

describe('LspManager', () => {
  it('lazy-spawns a client on first get()', async () => {
    const factory = vi.fn(async (language: any) => {
      const client = new LspClient({
        language, projectPath: '/tmp/proj', connection: makeFakeConnection(),
      });
      await client.initialize();
      return client;
    });
    const mgr = new LspManager({ projectPath: '/tmp/proj', clientFactory: factory });
    const c = await mgr.get('python');
    expect(c).toBeTruthy();
    expect(factory).toHaveBeenCalledTimes(1);
    const c2 = await mgr.get('python');
    expect(c2).toBe(c);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('returns null for a language whose binary is missing', async () => {
    const factory = vi.fn(async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    const mgr = new LspManager({ projectPath: '/tmp/proj', clientFactory: factory });
    const c = await mgr.get('python');
    expect(c).toBeNull();
    const c2 = await mgr.get('python');
    expect(c2).toBeNull();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('status reflects per-language state', async () => {
    const factory = vi.fn(async (language: any) => {
      const client = new LspClient({
        language, projectPath: '/tmp/proj', connection: makeFakeConnection(),
      });
      await client.initialize();
      return client;
    });
    const mgr = new LspManager({ projectPath: '/tmp/proj', clientFactory: factory });
    expect(mgr.status('python')).toBe('missing');
    await mgr.get('python');
    expect(mgr.status('python')).toBe('ok');
  });

  it('shutdown closes all clients', async () => {
    const clients: any[] = [];
    const factory = vi.fn(async (language: any) => {
      const c: any = new LspClient({ language, projectPath: '/tmp/proj', connection: makeFakeConnection() });
      c.shutdown = vi.fn(async () => {});
      await c.initialize();
      clients.push(c);
      return c;
    });
    const mgr = new LspManager({ projectPath: '/tmp/proj', clientFactory: factory });
    await mgr.get('python');
    await mgr.get('typescript');
    await mgr.shutdown();
    expect(clients[0].shutdown).toHaveBeenCalled();
    expect(clients[1].shutdown).toHaveBeenCalled();
  });
});
