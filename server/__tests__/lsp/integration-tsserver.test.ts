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
const FIXTURES = path.resolve(__dirname, '../fixtures/lsp/typescript');
const RUN_INTEGRATION = process.env.LSP_INTEGRATION === '1';

describe.skipIf(!RUN_INTEGRATION)('integration: typescript-language-server', () => {
  let repoDir: string;
  let client: LspClient;

  beforeAll(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-integration-ts-'));
    for (const f of fs.readdirSync(FIXTURES)) {
      fs.copyFileSync(path.join(FIXTURES, f), path.join(repoDir, f));
    }
    execSync('git init', { cwd: repoDir });

    const child = spawn('typescript-language-server', ['--stdio'], { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] });
    const conn = createMessageConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!),
    );
    client = new LspClient({ language: 'typescript', projectPath: repoDir, connection: conn });
    client.attachChild(child);
    await client.initialize();
    await client.waitReady(15_000);
  }, 45_000);

  afterAll(async () => {
    if (client) await client.shutdown();
    if (repoDir) fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('resolves greet from b.ts to a.ts', async () => {
    const b = path.join(repoDir, 'b.ts');
    await client.openFile(b);
    const src = fs.readFileSync(b, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('console.log(greet'));
    const character = src[line].indexOf('greet');
    const locs = await client.definition(b, { line, character });
    expect(locs.length).toBeGreaterThan(0);
    expect(locs[0].uri).toContain('a.ts');
  });

  it('hover shows function signature', async () => {
    const b = path.join(repoDir, 'b.ts');
    await client.openFile(b);
    const src = fs.readFileSync(b, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('console.log(greet'));
    const character = src[line].indexOf('greet');
    const hover = await client.hover(b, { line, character });
    expect(hover).toBeTruthy();
    expect(hover!).toMatch(/greet.*name.*string/);
  });

  it('references to greet include b.ts', async () => {
    const a = path.join(repoDir, 'a.ts');
    await client.openFile(a);
    await client.openFile(path.join(repoDir, 'b.ts'));
    const src = fs.readFileSync(a, 'utf8').split('\n');
    const line = src.findIndex((l) => l.startsWith('export function greet'));
    const character = src[line].indexOf('greet');
    const refs = await client.references(a, { line, character });
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((r: { uri: string }) => r.uri.includes('b.ts'))).toBe(true);
  });
});
