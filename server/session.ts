import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getBranchDiff, getSelectedCommitsDiff, getRepoMeta,
} from './git-ops.js';

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

  private _round = 0;
  private _items: SessionItem[] = [
    { id: 'diff', type: 'diff', title: 'Code Changes' },
  ];
  private _claudeComments: Record<string, ClaudeComment[]> = {};
  private _sseClients: SSEClient[] = [];
  private _analysis: Record<string, unknown> | null = null;

  constructor(opts: {
    repoPath: string;
    baseBranch: string;
    description?: string;
    outputPath?: string;
  }) {
    this.repoPath = opts.repoPath;
    this.baseBranch = opts.baseBranch;
    this.description = opts.description ?? '';
    this.outputPath = opts.outputPath ?? '';
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
    };
  }

  // --- Mutations ---

  setAnalysis(analysis: Record<string, unknown>): void {
    this._analysis = analysis;
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
    return { ok: true, id: itemId, items: this._items };
  }

  addComments(itemId: string, comments: ClaudeComment[]): number {
    if (!this._claudeComments[itemId]) {
      this._claudeComments[itemId] = [];
    }
    this._claudeComments[itemId].push(...comments);
    return this._claudeComments[itemId].length;
  }

  deleteComment(itemId: string, index: number): void {
    const items = this._claudeComments[itemId];
    if (items && index >= 0 && index < items.length) {
      items.splice(index, 1);
    }
  }

  clearComments(itemId?: string): void {
    if (itemId) {
      delete this._claudeComments[itemId];
    } else {
      this._claudeComments = {};
    }
  }

  submitReview(commentsText: string): number {
    this._round++;
    const currentRound = this._round;

    appendFileSync(this.outputPath, `\n---\n# Review Round ${currentRound}\n\n${commentsText}\n`);
    writeFileSync(this.outputPath + '.signal', String(currentRound));

    return currentRound;
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
