import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface ProjectBlob {
  slug: string;
  repoPath: string;
  baseBranch: string;
  description: string;
  items: { id: string; type: 'diff' | 'document'; title: string; path?: string }[];
  claudeComments: Record<string, { file?: string; line?: number; side?: string; block?: number; comment: string }[]>;
  analysis: Record<string, unknown> | null;
  round: number;
  userComments: Record<string, string>;
  reviewedFiles: string[];
  resolvedComments: string[];
  sidebarView: string;
}

const DB_DIR = join(homedir(), '.lgtm');
const DB_PATH = join(DB_DIR, 'data.db');

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (!_db) {
    mkdirSync(DB_DIR, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        slug TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )
    `);
  }
  return _db;
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
