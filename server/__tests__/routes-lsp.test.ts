import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { createApp } from '../app.js';
import { SessionManager } from '../session-manager.js';
import { initStore, closeStore } from '../store.js';

let testDbDir: string;

beforeAll(() => {
  testDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgtm-lsp-test-db-'));
  initStore(path.join(testDbDir, 'test.db'));
});

afterAll(() => {
  closeStore();
  fs.rmSync(testDbDir, { recursive: true, force: true });
});

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
  if (mgr) {
    for (const project of mgr.list()) mgr.deregister(project.slug);
    await mgr.shutdownAll();
  }
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

describe('GET /project/:slug/lsp/state', () => {
  it('returns per-language status straight from manager.status (no spawn)', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;

    const getSpy = vi.fn();
    (session.lsp as any).get = getSpy;
    (session.lsp as any).status = (lang: string) =>
      lang === 'python' ? 'ok' : lang === 'typescript' ? 'indexing' : 'missing';

    const app = createApp(mgr);
    const resp = await request(app).get(`/project/${slug}/lsp/state`);
    expect(resp.status).toBe(200);
    expect(resp.body).toEqual({ python: 'ok', typescript: 'indexing', rust: 'missing' });
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe('POST /project/:slug/lsp/warm', () => {
  it('calls get() once per requested language and returns immediately with current status', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;

    const getCalls: string[] = [];
    (session.lsp as any).get = vi.fn((lang: string) => {
      getCalls.push(lang);
      return new Promise(() => {}); // never resolves — endpoint must not await this
    });
    (session.lsp as any).status = () => 'missing';

    const app = createApp(mgr);
    const resp = await request(app)
      .post(`/project/${slug}/lsp/warm`)
      .send({ languages: ['python', 'typescript', 'unknown'] });
    expect(resp.status).toBe(200);
    expect(resp.body.warmed).toEqual(['python', 'typescript']);
    expect(resp.body.state).toEqual({ python: 'missing', typescript: 'missing', rust: 'missing' });
    expect(getCalls).toEqual(['python', 'typescript']);
  });

  it('swallows spawn errors so a warm of one language does not break others', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;
    (session.lsp as any).get = vi.fn(async (lang: string) => {
      if (lang === 'python') throw new Error('boom');
      return null;
    });
    (session.lsp as any).status = () => 'missing';

    const app = createApp(mgr);
    const resp = await request(app)
      .post(`/project/${slug}/lsp/warm`)
      .send({ languages: ['python', 'typescript'] });
    expect(resp.status).toBe(200);
    expect(resp.body.warmed).toEqual(['python', 'typescript']);
  });
});

describe('GET /project/:slug/lsp/bootstrap', () => {
  it('reports presentInRepo from tracked file extensions and current LSP status', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n', 'README.md': '# hi\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;
    (session.lsp as any).status = () => 'missing';

    const app = createApp(mgr);
    const resp = await request(app).get(`/project/${slug}/lsp/bootstrap`);
    expect(resp.status).toBe(200);
    const plan = resp.body.plan as Array<{ language: string; presentInRepo: boolean; installCommand: string }>;
    const py = plan.find((p) => p.language === 'python')!;
    const ts = plan.find((p) => p.language === 'typescript')!;
    const rs = plan.find((p) => p.language === 'rust')!;
    expect(py.presentInRepo).toBe(true);
    expect(ts.presentInRepo).toBe(false);
    expect(rs.presentInRepo).toBe(false);
    expect(py.installCommand).toContain('ty');
    expect(ts.installCommand).toContain('typescript-language-server');
    expect(rs.installCommand).toContain('rust-analyzer');
  });
});

describe('POST /project/:slug/lsp/bootstrap', () => {
  it('rejects empty / unrecognized language lists', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);

    const app = createApp(mgr);
    const resp = await request(app).post(`/project/${slug}/lsp/bootstrap`).send({ languages: [] });
    expect(resp.status).toBe(400);
  });
});

describe('GET /project/:slug/lsp/debug', () => {
  it('returns per-language stderr ring buffer and state', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;
    const fakeClient = {
      state: 'ready',
      stderrRing: ['line a', 'line b'],
      openFiles: () => ['/tmp/proj/foo.py'],
    };
    (session.lsp as any).get = vi.fn(async (lang: string) => lang === 'python' ? fakeClient : null);

    const app = createApp(mgr);
    const resp = await request(app).get(`/project/${slug}/lsp/debug`);
    expect(resp.status).toBe(200);
    expect(resp.body.python).toMatchObject({ state: 'ready', stderr: ['line a', 'line b'] });
    expect(resp.body.typescript).toMatchObject({ state: 'missing' });
  });
});

describe('DELETE /project/:slug/lsp/request', () => {
  it('calls client.cancel for the specified method + position', async () => {
    repoDir = makeRepo({ 'foo.py': 'x = 1\n' });
    mgr = new SessionManager(9900);
    const { slug } = mgr.register(repoDir);
    const session = mgr.get(slug)!;
    const cancel = vi.fn();
    const fakeClient = { cancel };
    (session.lsp as any).get = vi.fn(async () => fakeClient);

    const app = createApp(mgr);
    const resp = await request(app)
      .delete(`/project/${slug}/lsp/request?method=definition&file=foo.py&line=0&character=0`);
    expect(resp.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith('definition', expect.stringContaining('foo.py'), { line: 0, character: 0 });
  });
});
