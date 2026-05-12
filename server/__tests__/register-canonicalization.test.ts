import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGitFixture, type GitFixture } from './helpers/git-fixture.js';
import { initStore, closeStore } from '../store.js';
import { SessionManager } from '../session-manager.js';

describe('SessionManager.register canonicalization', () => {
  let fixture: GitFixture;
  let tmpDir: string;
  let manager: SessionManager;

  beforeAll(() => {
    fixture = createGitFixture();
    tmpDir = mkdtempSync(join(tmpdir(), 'lgtm-canon-test-'));
    initStore(join(tmpDir, 'test.db'));
    manager = new SessionManager(9999);
  });

  afterAll(() => {
    for (const project of manager.list()) {
      manager.deregister(project.slug);
    }
    closeStore();
    fixture.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('converges on the same project when called with symlinked vs. realpath form', () => {
    // On macOS, mkdtempSync returns /var/folders/... but the realpath is
    // /private/var/folders/.... Linux CI usually has no symlink difference,
    // in which case this is a trivial no-op assertion.
    const symlinkForm = fixture.repoPath;
    const realForm = realpathSync(symlinkForm);

    const r1 = manager.register(symlinkForm);
    const r2 = manager.register(realForm);

    expect(r2.slug).toBe(r1.slug);
    expect(manager.list().filter(p => p.slug === r1.slug)).toHaveLength(1);
  });

  it('stores the canonical (realpath) form as repoPath', () => {
    const stored = manager.list()[0];
    expect(stored).toBeDefined();
    expect(stored.repoPath).toBe(realpathSync(fixture.repoPath));
  });
});
