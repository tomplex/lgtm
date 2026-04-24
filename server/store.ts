import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export interface ProjectBlob {
  slug: string;
  repoPath: string;
  baseBranch: string;
  description: string;
  items: { id: string; type: 'diff' | 'document'; title: string; path?: string }[];
  comments: import('./comment-types.js').Comment[];
  analysis: Record<string, unknown> | null;
  walkthrough: import('./walkthrough-types.js').Walkthrough | null;
  rounds: Record<string, number>;
  reviewedFiles: string[];
  sortMode: 'path' | 'priority';
  groupMode: 'none' | 'phase';
  groupModeUserTouched: boolean;
  collapsedFolders: Record<string, boolean>;
}

function defaultDbPath(): string {
  return join(homedir(), '.lgtm', 'data.db');
}

let _db: Database.Database | null = null;

export function initStore(dbPath?: string): void {
  const resolvedPath = dbPath ?? process.env.LGTM_DB_PATH ?? defaultDbPath();
  mkdirSync(dirname(resolvedPath), { recursive: true });
  _db = new Database(resolvedPath);
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      slug TEXT PRIMARY KEY,
      data TEXT NOT NULL
    )
  `);
}

export function closeStore(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function db(): Database.Database {
  if (!_db) {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') {
      throw new Error(
        'store accessed before initStore(); tests must call initStore(tmpPath) in beforeAll to avoid polluting the production DB',
      );
    }
    initStore();
  }
  return _db!;
}

export function storeGet(slug: string): ProjectBlob | null {
  const row = db().prepare('SELECT data FROM projects WHERE slug = ?').get(slug) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

export function storePut(slug: string, blob: ProjectBlob): void {
  db().prepare(
    'INSERT INTO projects (slug, data) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET data = excluded.data'
  ).run(slug, JSON.stringify(blob));
}

export function storeDelete(slug: string): void {
  db().prepare('DELETE FROM projects WHERE slug = ?').run(slug);
}

export function storeList(): ProjectBlob[] {
  const rows = db().prepare('SELECT data FROM projects').all() as { data: string }[];
  return rows.map(r => JSON.parse(r.data));
}
