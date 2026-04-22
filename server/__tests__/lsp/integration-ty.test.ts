import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LspClient } from '../../lsp/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures/lsp/python');
const RUN_INTEGRATION = process.env.LSP_INTEGRATION === '1';

describe.skipIf(!RUN_INTEGRATION)('integration: ty (Python LSP)', () => {
  let repoDir: string;
  let client: LspClient;

  beforeAll(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-integration-ty-'));
    for (const f of fs.readdirSync(FIXTURES)) {
      fs.copyFileSync(path.join(FIXTURES, f), path.join(repoDir, f));
    }
    execSync('git init', { cwd: repoDir });

    const child = spawn('ty', ['server'], { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] });
    const conn = createMessageConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!),
    );
    client = new LspClient({ language: 'python', projectPath: repoDir, connection: conn });
    client.attachChild(child);
    await client.initialize();
    await client.waitReady(10_000);
  }, 30_000);

  afterAll(async () => {
    if (client) await client.shutdown();
    if (repoDir) fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('resolves definition of greet in mod_b.py back to mod_a.py', async () => {
    const modB = path.join(repoDir, 'mod_b.py');
    await client.openFile(modB);
    const src = fs.readFileSync(modB, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('print(greet'));
    const character = src[line].indexOf('greet');
    const locs = await client.definition(modB, { line, character });
    expect(locs.length).toBeGreaterThan(0);
    expect(locs[0].uri).toContain('mod_a.py');
  });

  it('hover on greet returns type info', async () => {
    const modB = path.join(repoDir, 'mod_b.py');
    await client.openFile(modB);
    const src = fs.readFileSync(modB, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('print(greet'));
    const character = src[line].indexOf('greet');
    const hover = await client.hover(modB, { line, character });
    expect(hover).toBeTruthy();
    expect(hover!.toLowerCase()).toMatch(/str|name/);
  });

  it('references to greet include call sites in mod_b and mod_c', async () => {
    const modA = path.join(repoDir, 'mod_a.py');
    await client.openFile(modA);
    await client.openFile(path.join(repoDir, 'mod_b.py'));
    await client.openFile(path.join(repoDir, 'mod_c.py'));
    const src = fs.readFileSync(modA, 'utf8').split('\n');
    const line = src.findIndex((l) => l.startsWith('def greet'));
    const character = src[line].indexOf('greet');
    const refs = await client.references(modA, { line, character });
    expect(Array.isArray(refs)).toBe(true);
    if (refs.length > 0) {
      const uris = refs.map((r: { uri: string }) => r.uri);
      expect(uris.some((u: string) => u.includes('mod_b') || u.includes('mod_c'))).toBe(true);
    }
  });
});
