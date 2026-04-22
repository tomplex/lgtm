import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { createApp } from '../app.js';
import { SessionManager } from '../session-manager.js';

function makeRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-lsp-test-'));
  execSync('git init', { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  execSync('git add .', { cwd: dir });
  execSync('git -c user.name=t -c user.email=t@t commit -m init', { cwd: dir });
  return dir;
}

let repoDir: string;
let mgr: SessionManager;

afterEach(async () => {
  if (mgr) await mgr.shutdownAll();
  if (repoDir && fs.existsSync(repoDir)) fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('GET /project/:slug/definition', () => {
  it('falls back to findSymbol when LSP is missing', async () => {
    repoDir = makeRepo({
      'foo.py': 'def hello():\n    return 1\n',
    });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);

    const session = mgr.get(slug)!;
    (session.lsp as any).get = vi.fn(async () => null);

    const app = createApp(mgr);
    const resp = await request(app)
      .get(`/project/${slug}/definition?file=foo.py&line=0&character=4`);
    expect(resp.status).toBe(200);
    expect(resp.body.status).toMatch(/fallback|missing/);
    expect(resp.body.result.results).toBeTruthy();
  });
});

describe('GET /project/:slug/hover', () => {
  it('returns hover content when LSP responds', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;
    const fakeClient = {
      hover: vi.fn(async () => '```py\nx: int\n```'),
      openFile: vi.fn(async () => {}),
    };
    (session.lsp as any).get = vi.fn(async () => fakeClient);

    const app = createApp(mgr);
    const resp = await request(app)
      .get(`/project/${slug}/hover?file=foo.py&line=0&character=0`);
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe('ok');
    expect(resp.body.result.signature).toContain('x: int');
  });

  it('returns empty result when LSP is missing', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;
    (session.lsp as any).get = vi.fn(async () => null);

    const app = createApp(mgr);
    const resp = await request(app)
      .get(`/project/${slug}/hover?file=foo.py&line=0&character=0`);
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe('missing');
    expect(resp.body.result).toEqual({});
  });
});

describe('GET /project/:slug/references', () => {
  it('translates Locations into file/line/snippet triples', async () => {
    repoDir = makeRepo({
      'foo.py': 'def hello():\n    return 1\n',
      'bar.py': 'from foo import hello\nhello()\nhello()\n',
    });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;
    const barUri = `file://${path.join(repoDir, 'bar.py')}`;
    const fakeClient = {
      openFile: vi.fn(async () => {}),
      references: vi.fn(async () => [
        { uri: barUri, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } } },
        { uri: barUri, range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } } },
      ]),
    };
    (session.lsp as any).get = vi.fn(async () => fakeClient);

    const app = createApp(mgr);
    const resp = await request(app)
      .get(`/project/${slug}/references?file=foo.py&line=0&character=4`);
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe('ok');
    expect(resp.body.result.references).toHaveLength(2);
    expect(resp.body.result.references[0]).toMatchObject({
      file: 'bar.py', line: 2, snippet: 'hello()',
    });
  });

  it('missing LSP returns empty result with status=missing', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    (mgr.get(slug)!.lsp as any).get = vi.fn(async () => null);

    const app = createApp(mgr);
    const resp = await request(app)
      .get(`/project/${slug}/references?file=foo.py&line=0&character=0`);
    expect(resp.body.status).toBe('missing');
    expect(resp.body.result.references).toEqual([]);
  });
});
