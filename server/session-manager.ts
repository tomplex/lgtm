import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { detectBaseBranch } from './git-ops.js';
import { Session } from './session.js';
import { storeList, storeDelete } from './store.js';

const REVIEW_DIR = '/tmp/claude-review';

interface ProjectInfo {
  slug: string;
  repoPath: string;
  description: string;
}

export class SessionManager {
  private _sessions = new Map<string, Session>();
  private _port: number;

  constructor(port: number) {
    this._port = port;
    mkdirSync(REVIEW_DIR, { recursive: true });

    // Restore persisted sessions
    for (const blob of storeList()) {
      const outputPath = `${REVIEW_DIR}/${blob.slug}.md`;
      const session = Session.fromBlob(blob, outputPath);
      session.watchRepo();
      this._sessions.set(blob.slug, session);
      console.log(`SESSION_RESTORED=${blob.slug} path=${blob.repoPath}`);
    }
  }

  register(
    repoPath: string,
    opts?: { description?: string; baseBranch?: string },
  ): { slug: string; url: string } {
    const absPath = resolve(repoPath);

    // Check if this path is already registered
    for (const [slug, session] of this._sessions) {
      if (session.repoPath === absPath) {
        return { slug, url: `http://127.0.0.1:${this._port}/project/${slug}/` };
      }
    }

    const slug = this._deriveSlug(absPath);
    const baseBranch = opts?.baseBranch || detectBaseBranch(absPath);
    const outputPath = `${REVIEW_DIR}/${slug}.md`;
    writeFileSync(outputPath, '');

    const session = new Session({
      repoPath: absPath,
      baseBranch,
      description: opts?.description ?? '',
      outputPath,
      slug,
    });

    session.persist();
    session.watchRepo();
    this._sessions.set(slug, session);
    return { slug, url: `http://127.0.0.1:${this._port}/project/${slug}/` };
  }

  get(slug: string): Session | undefined {
    return this._sessions.get(slug);
  }

  findByRepoPath(repoPath: string): { slug: string; session: Session } | undefined {
    const absPath = resolve(repoPath);
    for (const [slug, session] of this._sessions) {
      if (session.repoPath === absPath) {
        return { slug, session };
      }
    }
    return undefined;
  }

  list(): ProjectInfo[] {
    const projects: ProjectInfo[] = [];
    for (const [slug, session] of this._sessions) {
      projects.push({
        slug,
        repoPath: session.repoPath,
        description: session.description,
      });
    }
    return projects;
  }

  deregister(slug: string): boolean {
    const session = this._sessions.get(slug);
    if (session) session.unwatchRepo();
    const removed = this._sessions.delete(slug);
    if (removed) storeDelete(slug);
    return removed;
  }

  private _deriveSlug(absPath: string): string {
    let base = basename(absPath).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!base) base = 'project';
    let slug = base;
    let counter = 2;
    while (this._sessions.has(slug)) {
      slug = `${base}-${counter++}`;
    }
    return slug;
  }
}
