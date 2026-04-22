import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

describe('LspClient request methods', () => {
  it('definition sends textDocument/definition with uri + position', async () => {
    const conn = makeFakeConnection({
      sendRequest: vi.fn(async (method: string, params?: unknown) => {
        if (method === 'initialize') return { capabilities: {} };
        if (method === 'textDocument/definition') {
          expect(params).toMatchObject({
            textDocument: { uri: expect.stringContaining('/tmp/proj/foo.py') },
            position: { line: 10, character: 4 },
          });
          return [{ uri: 'file:///tmp/proj/bar.py', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } } }];
        }
        return null;
      }) as any,
    });
    const client = new LspClient({ language: 'python', projectPath: '/tmp/proj', connection: conn });
    await client.initialize();
    const locs = await client.definition('/tmp/proj/foo.py', { line: 10, character: 4 });
    expect(locs).toHaveLength(1);
    expect(locs[0].uri).toContain('bar.py');
  });

  it('hover returns markdown-string contents', async () => {
    const conn = makeFakeConnection({
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'initialize') return { capabilities: {} };
        if (method === 'textDocument/hover') return { contents: { kind: 'markdown', value: '```py\ndef foo(x: int) -> str\n```' } };
        return null;
      }) as any,
    });
    const client = new LspClient({ language: 'python', projectPath: '/tmp/proj', connection: conn });
    await client.initialize();
    const hover = await client.hover('/tmp/proj/foo.py', { line: 0, character: 0 });
    expect(hover).toContain('def foo');
  });

  it('references returns array of Locations', async () => {
    const conn = makeFakeConnection({
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'initialize') return { capabilities: {} };
        if (method === 'textDocument/references') return [
          { uri: 'file:///tmp/proj/a.py', range: { start: { line: 5, character: 0 }, end: { line: 5, character: 3 } } },
          { uri: 'file:///tmp/proj/b.py', range: { start: { line: 9, character: 2 }, end: { line: 9, character: 5 } } },
        ];
        return null;
      }) as any,
    });
    const client = new LspClient({ language: 'python', projectPath: '/tmp/proj', connection: conn });
    await client.initialize();
    const refs = await client.references('/tmp/proj/a.py', { line: 0, character: 0 });
    expect(refs).toHaveLength(2);
  });
});

describe('LspClient openFile / closeFile', () => {
  it('openFile sends didOpen with file content', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-client-open-'));
    const file = path.join(tmp, 'x.py');
    fs.writeFileSync(file, 'print(1)\n');
    const conn = makeFakeConnection();
    const client = new LspClient({ language: 'python', projectPath: tmp, connection: conn });
    await client.initialize();
    await client.openFile(file);
    const call = (conn.sendNotification as any).mock.calls.find((c: any[]) => c[0] === 'textDocument/didOpen');
    expect(call).toBeTruthy();
    expect(call[1].textDocument.text).toBe('print(1)\n');
    expect(client.isOpen(file)).toBe(true);
    fs.rmSync(tmp, { recursive: true });
  });

  it('closeFile sends didClose and drops from open set', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-client-close-'));
    const file = path.join(tmp, 'x.py');
    fs.writeFileSync(file, 'y = 2\n');
    const conn = makeFakeConnection();
    const client = new LspClient({ language: 'python', projectPath: tmp, connection: conn });
    await client.initialize();
    await client.openFile(file);
    await client.closeFile(file);
    const call = (conn.sendNotification as any).mock.calls.find((c: any[]) => c[0] === 'textDocument/didClose');
    expect(call).toBeTruthy();
    expect(client.isOpen(file)).toBe(false);
    fs.rmSync(tmp, { recursive: true });
  });

  it('openFile is idempotent', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-client-idem-'));
    const file = path.join(tmp, 'x.py');
    fs.writeFileSync(file, '');
    const conn = makeFakeConnection();
    const client = new LspClient({ language: 'python', projectPath: tmp, connection: conn });
    await client.initialize();
    await client.openFile(file);
    await client.openFile(file);
    const opens = (conn.sendNotification as any).mock.calls.filter((c: any[]) => c[0] === 'textDocument/didOpen');
    expect(opens).toHaveLength(1);
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('LspClient request lifecycle', () => {
  it('timeout rejects with LspTimeoutError', async () => {
    const conn = makeFakeConnection({
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'initialize') return { capabilities: {} };
        return new Promise(() => {}); // hangs forever
      }) as any,
    });
    const client = new LspClient({ language: 'python', projectPath: '/tmp/proj', connection: conn, requestTimeoutMs: 50 });
    await client.initialize();
    await expect(client.definition('/tmp/proj/foo.py', { line: 0, character: 0 }))
      .rejects.toThrow(/timed out/);
  });

  it('dedups concurrent identical requests into one in-flight promise', async () => {
    const send = vi.fn(async (method: string) => {
      if (method === 'initialize') return { capabilities: {} };
      await new Promise(r => setTimeout(r, 20));
      return [];
    });
    const conn = makeFakeConnection({ sendRequest: send as any });
    const client = new LspClient({ language: 'python', projectPath: '/tmp/proj', connection: conn });
    await client.initialize();
    const [a, b] = await Promise.all([
      client.definition('/tmp/proj/foo.py', { line: 0, character: 0 }),
      client.definition('/tmp/proj/foo.py', { line: 0, character: 0 }),
    ]);
    expect(a).toBe(b);
    const defCalls = send.mock.calls.filter((c: any[]) => c[0] === 'textDocument/definition');
    expect(defCalls).toHaveLength(1);
  });

  it('shutting-down state rejects new requests immediately', async () => {
    const conn = makeFakeConnection();
    const client = new LspClient({ language: 'python', projectPath: '/tmp/proj', connection: conn });
    await client.initialize();
    const shutdownPromise = client.shutdown();
    await expect(client.definition('/tmp/proj/foo.py', { line: 0, character: 0 }))
      .rejects.toThrow(/shutting down/);
    await shutdownPromise;
  });
});

describe('LspClient crash marking', () => {
  it('markCrashed flips state to crashed and rejects ready waiters', async () => {
    const conn = makeFakeConnection();
    const client = new LspClient({ language: 'rust', projectPath: '/tmp/proj', connection: conn });
    const ready = client.waitReady(1000);
    await client.initialize();
    expect(client.state).toBe('indexing');
    client.markCrashed('exit code 101');
    await expect(ready).rejects.toThrow(/crashed/);
    expect(client.state).toBe('crashed');
  });
});
