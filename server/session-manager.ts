import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { detectBaseBranch } from './git-ops.js';
import { Session } from './session.js';

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
    });

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
    return this._sessions.delete(slug);
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
