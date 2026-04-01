import { existsSync, readFileSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  getBranchDiff, getSelectedCommitsDiff, getRepoMeta,
} from './git-ops.js';
import { storePut, type ProjectBlob } from './store.js';

// --- Types ---

interface SessionItem {
  id: string;
  type: 'diff' | 'document';
  title: string;
  path?: string;
}

interface ClaudeComment {
  file?: string;
  line?: number;
  side?: 'new' | 'old';
  block?: number;
  comment: string;
}

export interface SSEClient {
  send: (event: string, data: unknown) => void;
}

// --- Session ---

export class Session {
  readonly repoPath: string;
  readonly baseBranch: string;
  readonly description: string;
  readonly outputPath: string;

  private _slug: string = '';
  private _round = 0;
  private _items: SessionItem[] = [
    { id: 'diff', type: 'diff', title: 'Code Changes' },
  ];
  private _claudeComments: Record<string, ClaudeComment[]> = {};
  private _sseClients: SSEClient[] = [];
  private _analysis: Record<string, unknown> | null = null;
  private _userComments: Record<string, string> = {};
  private _reviewedFiles = new Set<string>();
  private _resolvedComments = new Set<string>();
  private _sidebarView = 'flat';

  constructor(opts: {
    repoPath: string;
    baseBranch: string;
    description?: string;
    outputPath?: string;
    slug?: string;
  }) {
    this.repoPath = opts.repoPath;
    this.baseBranch = opts.baseBranch;
    this.description = opts.description ?? '';
    this.outputPath = opts.outputPath ?? '';
    this._slug = opts.slug ?? '';
  }

  // --- Persistence ---

  toBlob(): ProjectBlob {
    return {
      slug: this._slug,
      repoPath: this.repoPath,
      baseBranch: this.baseBranch,
      description: this.description,
      items: this._items,
      claudeComments: this._claudeComments,
      analysis: this._analysis,
      round: this._round,
      userComments: this._userComments,
      reviewedFiles: Array.from(this._reviewedFiles),
      resolvedComments: Array.from(this._resolvedComments),
      sidebarView: this._sidebarView,
    };
  }

  persist(): void {
    if (!this._slug) return;
    storePut(this._slug, this.toBlob());
  }

  static fromBlob(blob: ProjectBlob, outputPath: string): Session {
    const session = new Session({
      repoPath: blob.repoPath,
      baseBranch: blob.baseBranch,
      description: blob.description,
      outputPath,
      slug: blob.slug,
    });
    session._items = blob.items;
    session._claudeComments = blob.claudeComments as Record<string, ClaudeComment[]>;
    session._analysis = blob.analysis;
    session._round = blob.round;
    session._userComments = blob.userComments ?? {};
    session._reviewedFiles = new Set(blob.reviewedFiles ?? []);
    session._resolvedComments = new Set(blob.resolvedComments ?? []);
    session._sidebarView = blob.sidebarView ?? 'flat';
    return session;
  }

  // --- Queries ---

  get items(): SessionItem[] {
    return this._items;
  }

  get analysis(): Record<string, unknown> | null {
    return this._analysis;
  }

  getItemData(itemId: string, commits?: string): Record<string, unknown> {
    const claudeComments = this._claudeComments[itemId] ?? [];

    if (itemId === 'diff') {
      let diff: string;
      if (commits) {
        const shas = commits.split(',').map(s => s.trim()).filter(Boolean);
        diff = getSelectedCommitsDiff(this.repoPath, shas);
      } else {
        diff = getBranchDiff(this.repoPath, this.baseBranch);
      }
      return {
        mode: 'diff',
        diff,
        description: this.description,
        meta: getRepoMeta(this.repoPath, this.baseBranch),
        claudeComments,
        userComments: this._userComments,
      };
    }

    const item = this._items.find(i => i.id === itemId);
    if (!item) {
      return { mode: 'error', error: `Item not found: ${itemId}` };
    }

    const p = item.path!;
    const content = existsSync(p) ? readFileSync(p, 'utf-8') : '';
    const filename = p.split('/').pop()!;
    const isMarkdown = /\.(md|mdx|markdown)$/.test(filename);

    return {
      mode: 'file',
      content,
      filename,
      filepath: p,
      markdown: isMarkdown,
      title: item.title ?? filename,
      claudeComments,
      userComments: this._userComments,
    };
  }

  // --- Mutations ---

  setAnalysis(analysis: Record<string, unknown>): void {
    this._analysis = analysis;
    this.persist();
  }

  addItem(itemId: string, title: string, filepath: string): Record<string, unknown> {
    const absPath = resolve(filepath);
    const existing = this._items.find(i => i.id === itemId);
    if (existing) {
      existing.path = absPath;
      existing.title = title;
    } else {
      this._items.push({ id: itemId, type: 'document', title, path: absPath });
    }
    this.persist();
    return { ok: true, id: itemId, items: this._items };
  }

  removeItem(itemId: string): boolean {
    if (itemId === 'diff') return false;
    const idx = this._items.findIndex(i => i.id === itemId);
    if (idx === -1) return false;
    this._items.splice(idx, 1);
    delete this._claudeComments[itemId];
    this.persist();
    return true;
  }

  addComments(itemId: string, comments: ClaudeComment[]): number {
    if (!this._claudeComments[itemId]) {
      this._claudeComments[itemId] = [];
    }
    this._claudeComments[itemId].push(...comments);
    this.persist();
    return this._claudeComments[itemId].length;
  }

  deleteComment(itemId: string, index: number): void {
    const items = this._claudeComments[itemId];
    if (items && index >= 0 && index < items.length) {
      items.splice(index, 1);
    }
    this.persist();
  }

  clearComments(itemId?: string): void {
    if (itemId) {
      delete this._claudeComments[itemId];
    } else {
      this._claudeComments = {};
    }
    this.persist();
  }

  async submitReview(commentsText: string): Promise<number> {
    this._round++;
    const currentRound = this._round;
    this.persist();

    await appendFile(this.outputPath, `\n---\n# Review Round ${currentRound}\n\n${commentsText}\n`);
    await writeFile(this.outputPath + '.signal', String(currentRound));

    return currentRound;
  }

  // --- User State ---

  get userComments(): Record<string, string> {
    return this._userComments;
  }

  get userReviewedFiles(): string[] {
    return Array.from(this._reviewedFiles);
  }

  get userResolvedComments(): string[] {
    return Array.from(this._resolvedComments);
  }

  get userSidebarView(): string {
    return this._sidebarView;
  }

  setUserComment(key: string, text: string): void {
    this._userComments[key] = text;
    this.persist();
  }

  deleteUserComment(key: string): void {
    delete this._userComments[key];
    this.persist();
  }

  setUserReviewedFiles(files: string[]): void {
    this._reviewedFiles = new Set(files);
    this.persist();
  }

  toggleUserReviewedFile(path: string): boolean {
    const nowReviewed = !this._reviewedFiles.has(path);
    if (nowReviewed) this._reviewedFiles.add(path);
    else this._reviewedFiles.delete(path);
    this.persist();
    return nowReviewed;
  }

  setUserResolvedComments(keys: string[]): void {
    this._resolvedComments = new Set(keys);
    this.persist();
  }

  toggleUserResolvedComment(key: string): boolean {
    const nowResolved = !this._resolvedComments.has(key);
    if (nowResolved) this._resolvedComments.add(key);
    else this._resolvedComments.delete(key);
    this.persist();
    return nowResolved;
  }

  setUserSidebarView(view: string): void {
    this._sidebarView = view;
    this.persist();
  }

  // --- SSE ---

  subscribe(client: SSEClient): void {
    this._sseClients.push(client);
  }

  unsubscribe(client: SSEClient): void {
    this._sseClients = this._sseClients.filter(c => c !== client);
  }

  broadcast(event: string, data: unknown): void {
    for (const client of this._sseClients) {
      try {
        client.send(event, data);
      } catch {
        // client disconnected
      }
    }
  }
}
