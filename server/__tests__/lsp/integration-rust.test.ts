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
const FIXTURES = path.resolve(__dirname, '../fixtures/lsp/rust');
const RUN_INTEGRATION = process.env.LSP_INTEGRATION === '1';

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

describe.skipIf(!RUN_INTEGRATION)('integration: rust-analyzer', () => {
  let repoDir: string;
  let client: LspClient;

  beforeAll(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-integration-rust-'));
    copyDir(FIXTURES, repoDir);
    execSync('git init', { cwd: repoDir });

    const child = spawn('rust-analyzer', [], { cwd: repoDir, stdio: ['pipe', 'pipe', 'pipe'] });
    const conn = createMessageConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!),
    );
    client = new LspClient({ language: 'rust', projectPath: repoDir, connection: conn });
    client.attachChild(child);
    await client.initialize();
    await client.waitReady(180_000);
  }, 240_000);

  afterAll(async () => {
    if (client) await client.shutdown();
    if (repoDir) fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('resolves greet from main.rs to lib.rs', async () => {
    const main = path.join(repoDir, 'src/main.rs');
    await client.openFile(main);
    const src = fs.readFileSync(main, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('greet("world")'));
    const character = src[line].indexOf('greet');
    const locs = await client.definition(main, { line, character });
    expect(locs.length).toBeGreaterThan(0);
    expect(locs[0].uri).toContain('lib.rs');
  }, 60_000);

  it('hover on greet shows fn signature', async () => {
    const main = path.join(repoDir, 'src/main.rs');
    await client.openFile(main);
    const src = fs.readFileSync(main, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('greet("world")'));
    const character = src[line].indexOf('greet');
    const hover = await client.hover(main, { line, character });
    expect(hover).toBeTruthy();
    expect(hover!).toMatch(/fn greet/);
  }, 60_000);

  it('references to greet include main.rs', async () => {
    const lib = path.join(repoDir, 'src/lib.rs');
    await client.openFile(lib);
    await client.openFile(path.join(repoDir, 'src/main.rs'));
    const src = fs.readFileSync(lib, 'utf8').split('\n');
    const line = src.findIndex((l) => l.includes('pub fn greet'));
    const character = src[line].indexOf('greet');
    const refs = await client.references(lib, { line, character });
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((r: { uri: string }) => r.uri.includes('main.rs'))).toBe(true);
  }, 60_000);
});
