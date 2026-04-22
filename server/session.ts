import { existsSync, readFileSync, statSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  getBranchDiff, getSelectedCommitsDiff, getRepoMeta, getRepoMetaAsync,
  type RepoMeta,
} from './git-ops.js';
import { storePut, type ProjectBlob } from './store.js';
import { CommentStore } from './comment-store.js';
import { migrateBlob } from './comment-migration.js';
import type { Comment, CreateComment, CommentFilter } from './comment-types.js';
import { LspManager } from './lsp/index.js';

// --- Types ---

interface SessionItem {
  id: string;
  type: 'diff' | 'document';
  title: string;
  path?: string;
}

export interface SSEClient {
  send: (event: string, data: unknown) => void;
}

// --- Session ---

export class Session {
  readonly repoPath: string;
  baseBranch: string;
  readonly description: string;
  readonly outputPath: string;

  private _slug: string = '';
  private _rounds: Record<string, number> = {};
  private _items: SessionItem[] = [
    { id: 'diff', type: 'diff', title: 'Code Changes' },
  ];
  private _commentStore = new CommentStore();
  private _sseClients: SSEClient[] = [];
  private _analysis: Record<string, unknown> | null = null;
  private _reviewedFiles = new Set<string>();
  private _sortMode: 'path' | 'priority' = 'path';
  private _groupMode: 'none' | 'phase' = 'none';
  private _groupModeUserTouched = false;
  private _collapsedFolders: Record<string, boolean> = {};
  private _metaCache: { meta: RepoMeta; at: number } | null = null;
  private _lsp: LspManager;

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
    this._lsp = new LspManager({ projectPath: this.repoPath });
  }

  get lsp(): LspManager {
    return this._lsp;
  }

  async destroy(): Promise<void> {
    await this._lsp.shutdown();
  }

  // --- Persistence ---

  toBlob(): ProjectBlob {
    return {
      slug: this._slug,
      repoPath: this.repoPath,
      baseBranch: this.baseBranch,
      description: this.description,
      items: this._items,
      comments: this._commentStore.toJSON(),
      analysis: this._analysis,
      rounds: this._rounds,
      reviewedFiles: Array.from(this._reviewedFiles),
      sortMode: this._sortMode,
      groupMode: this._groupMode,
      groupModeUserTouched: this._groupModeUserTouched,
      collapsedFolders: this._collapsedFolders,
    };
  }

  persist(): void {
    if (!this._slug) return;
    storePut(this._slug, this.toBlob());
  }

  static fromBlob(blob: Record<string, unknown>, outputPath: string): Session {
    const migrated = migrateBlob(blob);
    const session = new Session({
      repoPath: migrated.repoPath as string,
      baseBranch: migrated.baseBranch as string,
      description: migrated.description as string,
      outputPath,
      slug: migrated.slug as string,
    });
    session._items = migrated.items as SessionItem[];
    session._commentStore = CommentStore.fromJSON(migrated.comments);
    session._analysis = migrated.analysis as Record<string, unknown> | null;
    // Migrate old single round to per-item rounds
    if (migrated.rounds && typeof migrated.rounds === 'object' && !Array.isArray(migrated.rounds)) {
      session._rounds = migrated.rounds as Record<string, number>;
    } else if (typeof migrated.round === 'number' && migrated.round > 0) {
      session._rounds = { diff: migrated.round as number };
    }
    session._reviewedFiles = new Set(migrated.reviewedFiles as string[]);
    session._sortMode = (migrated.sortMode as 'path' | 'priority') ?? 'path';
    session._groupMode = (migrated.groupMode as 'none' | 'phase') ?? 'none';
    session._groupModeUserTouched = (migrated.groupModeUserTouched as boolean) ?? false;
    session._collapsedFolders = (migrated.collapsedFolders as Record<string, boolean>) ?? {};
    // Legacy `sidebarView` field is read and discarded; persisted blobs will no longer include it.
    return session;
  }

  // --- Queries ---

  get items(): SessionItem[] {
    return this._items;
  }

  async getCachedMeta(ttlMs = 30_000): Promise<RepoMeta> {
    const now = Date.now();
    if (this._metaCache && now - this._metaCache.at < ttlMs) {
      return this._metaCache.meta;
    }
    const meta = await getRepoMetaAsync(this.repoPath, this.baseBranch);
    this._metaCache = { meta, at: now };
    return meta;
  }

  get analysis(): Record<string, unknown> | null {
    return this._analysis;
  }

  getItemData(itemId: string, commits?: string): Record<string, unknown> {
    const comments = this._commentStore.list({ item: itemId });

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
        comments,
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
      comments,
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
    this.clearComments(itemId);
    this.persist();
    return true;
  }

  async submitReview(commentsText: string, item?: string): Promise<number> {
    const key = item || 'diff';
    this._rounds[key] = (this._rounds[key] || 0) + 1;
    const currentRound = this._rounds[key];
    this.persist();

    const label = key === 'diff' ? '' : ` [${key}]`;
    await appendFile(this.outputPath, `\n---\n# Review Round ${currentRound}${label}\n\n${commentsText}\n`);
    await writeFile(this.outputPath + '.signal', `${key}:${currentRound}`);

    return currentRound;
  }

  // --- Comments ---

  addComment(input: CreateComment): Comment {
    const comment = this._commentStore.add(input);
    this.persist();
    return comment;
  }

  addComments(itemId: string, comments: { file?: string; line?: number; block?: number; comment: string }[]): number {
    for (const c of comments) {
      this._commentStore.add({
        author: 'claude',
        text: c.comment,
        item: itemId,
        file: c.file,
        line: c.line,
        block: c.block,
      });
    }
    this.persist();
    return this._commentStore.list({ item: itemId, author: 'claude' }).length;
  }

  getComment(id: string): Comment | undefined {
    return this._commentStore.get(id);
  }

  listComments(filter?: CommentFilter): Comment[] {
    return this._commentStore.list(filter);
  }

  updateComment(id: string, fields: Partial<Pick<Comment, 'text' | 'status'>>): Comment | undefined {
    const result = this._commentStore.update(id, fields);
    if (result) this.persist();
    return result;
  }

  deleteComment(itemId: string, commentId: string): boolean {
    const result = this._commentStore.delete(commentId);
    if (result) this.persist();
    return result;
  }

  clearComments(itemId?: string): void {
    if (itemId) {
      for (const c of this._commentStore.list({ item: itemId })) {
        this._commentStore.delete(c.id);
      }
    } else {
      const all = this._commentStore.list();
      for (const c of all) this._commentStore.delete(c.id);
    }
    this.persist();
  }

  // --- User State ---

  get userReviewedFiles(): string[] {
    return Array.from(this._reviewedFiles);
  }

  get userSidebarPrefs(): {
    sortMode: 'path' | 'priority';
    groupMode: 'none' | 'phase';
    groupModeUserTouched: boolean;
    collapsedFolders: Record<string, boolean>;
  } {
    return {
      sortMode: this._sortMode,
      groupMode: this._groupMode,
      groupModeUserTouched: this._groupModeUserTouched,
      collapsedFolders: this._collapsedFolders,
    };
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

  setUserSidebarPrefs(prefs: Partial<{
    sortMode: 'path' | 'priority';
    groupMode: 'none' | 'phase';
    groupModeUserTouched: boolean;
    collapsedFolders: Record<string, boolean>;
  }>): void {
    if (prefs.sortMode !== undefined) this._sortMode = prefs.sortMode;
    if (prefs.groupMode !== undefined) this._groupMode = prefs.groupMode;
    if (prefs.groupModeUserTouched !== undefined) this._groupModeUserTouched = prefs.groupModeUserTouched;
    if (prefs.collapsedFolders !== undefined) this._collapsedFolders = prefs.collapsedFolders;
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

  // --- Git watcher ---

  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _lastIndexMtime = 0;
  private _lastHeadContent = '';

  watchRepo(): void {
    if (this._pollTimer) return;
    const gitDir = join(this.repoPath, '.git');
    if (!existsSync(gitDir)) return;

    const indexPath = join(gitDir, 'index');
    const headPath = join(gitDir, 'HEAD');

    // Snapshot current state
    try { this._lastIndexMtime = statSync(indexPath).mtimeMs; } catch { /* ignore */ }
    try { this._lastHeadContent = readFileSync(headPath, 'utf-8'); } catch { /* ignore */ }

    this._pollTimer = setInterval(() => {
      let changed = false;
      try {
        const mtime = statSync(indexPath).mtimeMs;
        if (mtime !== this._lastIndexMtime) {
          this._lastIndexMtime = mtime;
          changed = true;
        }
      } catch { /* ignore */ }
      try {
        const head = readFileSync(headPath, 'utf-8');
        if (head !== this._lastHeadContent) {
          this._lastHeadContent = head;
          changed = true;
        }
      } catch { /* ignore */ }

      if (changed && this._sseClients.length > 0) {
        this.broadcast('git_changed', {});
      }
    }, 2000);
  }

  unwatchRepo(): void {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
  }
}
