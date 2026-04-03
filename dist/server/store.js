import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
function defaultDbPath() {
    return join(homedir(), '.lgtm', 'data.db');
}
let _db = null;
export function initStore(dbPath) {
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
export function closeStore() {
    if (_db) {
        _db.close();
        _db = null;
    }
}
function db() {
    if (!_db) {
        initStore();
    }
    return _db;
}
export function storeGet(slug) {
    const row = db().prepare('SELECT data FROM projects WHERE slug = ?').get(slug);
    return row ? JSON.parse(row.data) : null;
}
export function storePut(slug, blob) {
    db().prepare('INSERT INTO projects (slug, data) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET data = excluded.data').run(slug, JSON.stringify(blob));
}
export function storeDelete(slug) {
    db().prepare('DELETE FROM projects WHERE slug = ?').run(slug);
}
export function storeList() {
    const rows = db().prepare('SELECT data FROM projects').all();
    return rows.map(r => JSON.parse(r.data));
}
