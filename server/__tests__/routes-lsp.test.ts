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
