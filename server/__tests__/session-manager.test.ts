import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import { initStore, closeStore } from '../store.js';
import { SessionManager } from '../session-manager.js';

describe('SessionManager', () => {
  let fixture: GitFixture;
  let fixture2: GitFixture;
  let tmpDir: string;

  beforeAll(() => {
    fixture = createGitFixture();
    fixture2 = createGitFixture();
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-manager-test-'));
    initStore(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeStore();
    fixture.cleanup();
    fixture2.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('register creates a session and returns slug + url', () => {
    const manager = new SessionManager(9999);
    const result = manager.register(fixture.repoPath);
    expect(result.slug).toBeTruthy();
    expect(result.url).toContain('9999');
    expect(result.url).toContain(result.slug);
    manager.deregister(result.slug);
  });

  it('register with same repo returns existing session (deduplication)', () => {
    const manager = new SessionManager(9999);
    const first = manager.register(fixture.repoPath);
    const second = manager.register(fixture.repoPath);
    expect(second.slug).toBe(first.slug);
    manager.deregister(first.slug);
  });

  it('get returns session by slug', () => {
    const manager = new SessionManager(9999);
    const { slug } = manager.register(fixture.repoPath);
    const session = manager.get(slug);
    expect(session).toBeDefined();
    expect(session?.repoPath).toBe(fixture.repoPath);
    manager.deregister(slug);
  });

  it('findByRepoPath returns session by repo path', () => {
    const manager = new SessionManager(9999);
    manager.register(fixture.repoPath);
    const result = manager.findByRepoPath(fixture.repoPath);
    expect(result).toBeDefined();
    expect(result?.session.repoPath).toBe(fixture.repoPath);
    if (result) manager.deregister(result.slug);
  });

  it('list returns all registered sessions', () => {
    const manager = new SessionManager(9999);
    const r1 = manager.register(fixture.repoPath);
    const r2 = manager.register(fixture2.repoPath);
    const list = manager.list();
    expect(list.length).toBeGreaterThanOrEqual(2);
    manager.deregister(r1.slug);
    manager.deregister(r2.slug);
  });

  it('deregister removes session', () => {
    const manager = new SessionManager(9999);
    const { slug } = manager.register(fixture.repoPath);
    expect(manager.deregister(slug)).toBe(true);
    expect(manager.get(slug)).toBeUndefined();
  });

  it('deregister returns false for unknown slug', () => {
    const manager = new SessionManager(9999);
    expect(manager.deregister('nonexistent')).toBe(false);
  });

  it('handles slug collisions for repos with same directory name', () => {
    const manager = new SessionManager(9999);
    const r1 = manager.register(fixture.repoPath);
    const r2 = manager.register(fixture2.repoPath);
    expect(r1.slug).not.toBe(r2.slug);
    manager.deregister(r1.slug);
    manager.deregister(r2.slug);
  });

  it('register updates description on an existing session when passed', () => {
    const manager = new SessionManager(9999);
    const first = manager.register(fixture.repoPath, { description: 'first' });
    const session = manager.get(first.slug)!;
    expect(session.description).toBe('first');

    manager.register(fixture.repoPath, { description: 'second' });
    expect(session.description).toBe('second');
    manager.deregister(first.slug);
  });

  it('register preserves description when not passed', () => {
    const manager = new SessionManager(9999);
    manager.register(fixture.repoPath, { description: 'initial' });
    const session = manager.get(manager.findByRepoPath(fixture.repoPath)!.slug)!;
    manager.register(fixture.repoPath); // no opts
    expect(session.description).toBe('initial');
    manager.deregister(manager.findByRepoPath(fixture.repoPath)!.slug);
  });

  it('restores sessions from store on construction', () => {
    // Create a manager and register a project
    const manager1 = new SessionManager(9999);
    const { slug } = manager1.register(fixture.repoPath);

    // Create a new manager — should restore from store
    const manager2 = new SessionManager(9999);
    const session = manager2.get(slug);
    expect(session).toBeDefined();
    expect(session?.repoPath).toBe(fixture.repoPath);

    // Clean up both managers' watchers
    manager1.deregister(slug);
    // manager2 has its own session instance watching, deregister it too
    manager2.deregister(slug);
  });
});
