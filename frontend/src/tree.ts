import type { DiffFile, Analysis } from './state';

export interface FolderNode {
  kind: 'folder';
  id: string;
  name: string;
  fullPath: string;
  depth: number;
  children: TreeNode[];
}

export interface FileNode {
  kind: 'file';
  id: string;
  file: DiffFile;
  depth: number;
}

export type TreeNode = FolderNode | FileNode;

export interface BuildOpts {
  sort: 'path' | 'priority';
  group: 'none' | 'phase';
}

const PHASE_ORDER = ['review', 'skim', 'rubber-stamp'] as const;
type Phase = (typeof PHASE_ORDER)[number];

const PHASE_LABEL: Record<Phase, string> = {
  review: '● Review carefully',
  skim: '◐ Skim',
  'rubber-stamp': '○ Rubber stamp',
};

function filePhase(file: DiffFile, analysis: Analysis | null): Phase {
  return (analysis?.files[file.path]?.phase as Phase) ?? 'skim';
}

interface TrieNode {
  dirs: Map<string, TrieNode>;
  files: DiffFile[];
}

function emptyTrie(): TrieNode {
  return { dirs: new Map(), files: [] };
}

function insert(trie: TrieNode, file: DiffFile): void {
  const segments = file.path.split('/');
  const fileName = segments.pop()!;
  let node = trie;
  for (const seg of segments) {
    if (!node.dirs.has(seg)) node.dirs.set(seg, emptyTrie());
    node = node.dirs.get(seg)!;
  }
  node.files.push({ ...file, path: file.path });
  // Note: we store the file by its full path; the basename is `fileName` and used only for display.
  void fileName;
}

function buildFromTrie(trie: TrieNode, pathPrefix: string, depth: number, idPrefix: string): TreeNode[] {
  const out: TreeNode[] = [];

  for (const [dirName, sub] of trie.dirs) {
    // Walk a single-child chain and merge
    let chain = dirName + '/';
    let curPrefix = pathPrefix + chain;
    let cur = sub;
    while (cur.files.length === 0 && cur.dirs.size === 1) {
      const [nextName, nextNode] = cur.dirs.entries().next().value as [string, TrieNode];
      chain += nextName + '/';
      curPrefix += nextName + '/';
      cur = nextNode;
    }

    const folder: FolderNode = {
      kind: 'folder',
      id: idPrefix + curPrefix,
      name: chain,
      fullPath: curPrefix,
      depth,
      children: buildFromTrie(cur, curPrefix, depth + 1, idPrefix),
    };
    out.push(folder);
  }

  for (const f of trie.files) {
    out.push({
      kind: 'file',
      id: idPrefix + f.path,
      file: f,
      depth,
    });
  }

  return out;
}

export function buildTree(files: DiffFile[], analysis: Analysis | null, opts: BuildOpts): TreeNode[] {
  if (opts.group === 'phase' && analysis) {
    const byPhase: Record<Phase, DiffFile[]> = { review: [], skim: [], 'rubber-stamp': [] };
    for (const f of files) byPhase[filePhase(f, analysis)].push(f);

    const roots: TreeNode[] = [];
    for (const phase of PHASE_ORDER) {
      const phaseFiles = byPhase[phase];
      if (phaseFiles.length === 0) continue;
      const trie = emptyTrie();
      for (const f of phaseFiles) insert(trie, f);
      const idPrefix = phase + ':';
      roots.push({
        kind: 'folder',
        id: idPrefix + '__root__',
        name: PHASE_LABEL[phase],
        fullPath: idPrefix + '__root__',
        depth: 0,
        children: buildFromTrie(trie, '', 1, idPrefix),
      });
    }
    return roots;
  }

  const trie = emptyTrie();
  for (const f of files) insert(trie, f);
  return buildFromTrie(trie, '', 0, '');
}
